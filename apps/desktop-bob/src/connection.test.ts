import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { describe, expect, it } from "vitest";
import { readDesktopMode, verifyConnectedDesktop, daemonArgs, daemonConfig, daemonEnvironment, type ConnectedDesktop } from "./connection.js";

const settings = { BOB_DESKTOP_APP_URL: "https://app.example", BOB_DESKTOP_GATEWAY_URL: "wss://gateway.example/sessions",
  BOB_DESKTOP_API_KEY: "fixture-key", BOB_DESKTOP_WORKSPACE_ID: "workspace", BOB_DESKTOP_USER_ID: "alice", BOB_DESKTOP_DEV_DIR: "/tmp/work" };

it("keeps local-only mode explicit and rejects partial or credential-bearing connected configuration", () => {
  expect(readDesktopMode({})).toEqual({ kind: "local", roots: [] });
  expect(() => readDesktopMode({ BOB_DESKTOP_APP_URL: settings.BOB_DESKTOP_APP_URL })).toThrow("Connected desktop needs");
  expect(() => readDesktopMode({ ...settings, BOB_DESKTOP_APP_URL: "https://token@app.example" })).toThrow("without URL credentials");
  expect(() => readDesktopMode({ ...settings, BOB_DESKTOP_APP_URL: "https://app.example/wrong-api" })).toThrow("must be an origin");
});

it("launches the foreground Go peer with the same API data plane and an isolated workspace config", () => {
  const mode = readDesktopMode(settings) as ConnectedDesktop;
  expect(mode.apiUrl).toBe(`${mode.appUrl}/api`);
  expect(daemonArgs(mode, "/tmp/private/config.json")).toEqual(["start", "/tmp/work", "--config", "/tmp/private/config.json"]);
  expect(JSON.parse(daemonConfig(mode))).toEqual({ workspace_id: "workspace", dev_dir: "/tmp/work" });
  expect(daemonConfig(mode)).not.toContain(mode.apiKey);
  expect(daemonEnvironment(mode, { BOB_AUTH_TOKEN: "local-bootstrap" })).toMatchObject({ BOB_SERVER_URL: "https://app.example/api", BOB_AUTH_TOKEN: "fixture-key" });
});

describe("connected desktop loopback acceptance", () => {
  it("authenticates HTTP and WS peers, then delivers the UI-created session from that same API", async () => {
    let daemon: WebSocket | undefined;
    let gatewayUser = "alice";
    const sessions: string[] = [];
    const http = createServer((req, res) => {
      if (req.url === "/api/trpc/workspace.list") {
        if (req.headers.authorization !== "Bearer fixture-key") { res.writeHead(401); res.end(); return; }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ result: { data: { json: [{ workspace: { id: "workspace", ownerUserId: "alice" } }] } } })); return;
      }
      if (req.method === "POST" && req.url === "/api/sessions") {
        if (req.headers.cookie !== "fixture_session=alice") { res.writeHead(401); res.end(); return; }
        const sessionId = `session-${sessions.length + 1}`; sessions.push(sessionId);
        daemon?.send(JSON.stringify({ type: "session_available", sessionId }));
        res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ sessionId })); return;
      }
      res.end("<html>Remote Bob app</html>");
    });
    const gateway = new WebSocketServer({ noServer: true });
    http.on("upgrade", (req, socket, head) => {
      if (req.url !== "/sessions") { socket.destroy(); return; }
      gateway.handleUpgrade(req, socket, head, (peer) => gateway.emit("connection", peer));
    });
    gateway.on("connection", (peer) => peer.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type !== "hello") return;
      if (msg.token !== "fixture-key") { peer.send(JSON.stringify({ type: "error" })); return; }
      if (msg.deviceType === "daemon") {
        if (msg.workspaceId !== "workspace") { peer.send(JSON.stringify({ type: "error" })); return; }
        daemon = peer;
      }
      peer.send(JSON.stringify({ type: "hello_ok", userId: gatewayUser, heartbeatIntervalMs: 30000 }));
    }));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const mode = readDesktopMode({ ...settings, BOB_DESKTOP_APP_URL: origin, BOB_DESKTOP_GATEWAY_URL: origin.replace("http:", "ws:") + "/sessions" }) as ConnectedDesktop;
    let peer: WebSocket | undefined;
    try {
      await verifyConnectedDesktop(mode);
      gatewayUser = "wrong-principal";
      await expect(verifyConnectedDesktop(mode)).rejects.toThrow("identities do not match");
      gatewayUser = "alice";
      await expect(verifyConnectedDesktop({ ...mode, apiKey: "wrong" })).rejects.toThrow("API rejected");
      await expect(verifyConnectedDesktop({ ...mode, workspaceId: "foreign" })).rejects.toThrow("not owned");
      // Same launch environment consumed by the bundled foreground daemon.
      const env = daemonEnvironment(mode, {});
      peer = new WebSocket(env.BOB_GATEWAY_URL!);
      await once(peer, "open");
      const hello = once(peer, "message");
      peer.send(JSON.stringify({ type: "hello", deviceType: "daemon", clientId: "fixture-go-peer", token: env.BOB_AUTH_TOKEN, workspaceId: JSON.parse(daemonConfig(mode)).workspace_id }));
      expect(JSON.parse(String((await hello)[0])).type).toBe("hello_ok");
      const available = once(peer, "message");
      const created = await (await fetch(`${mode.appUrl}/api/sessions`, { method: "POST", headers: { cookie: "fixture_session=alice" } })).json() as { sessionId: string };
      expect(JSON.parse(String((await available)[0]))).toEqual({ type: "session_available", sessionId: created.sessionId });
      expect(sessions).toEqual([created.sessionId]);
    } finally {
      peer?.terminate(); for (const client of gateway.clients) client.terminate();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
});

it.runIf(process.platform === "darwin" && ["arm64", "x64"].includes(process.arch))("the actual bundled Go binary claims a session created through the connected API", async () => {
  const { spawn } = await import("node:child_process");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { terminateProcessTree } = await import("@bob/server/process-tree");
  const temp = await mkdtemp(path.join(tmpdir(), "bob-connected-go-"));
  const binary = fileURLToPath(new URL(`../resources/bin/bob-darwin-${process.arch === "x64" ? "amd64" : "arm64"}`, import.meta.url));
  let daemon: WebSocket | undefined;
  let connected!: () => void;
  let claimed!: (id: string) => void;
  const connectedPromise = new Promise<void>((resolve) => { connected = resolve; });
  const claimPromise = new Promise<string>((resolve) => { claimed = resolve; });
  const sessionId = "00000000-0000-4000-8000-000000000042";
  const http = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/sessions" && req.method === "POST") {
      if (req.headers.cookie !== "fixture_session=alice") { res.writeHead(401); res.end('{}'); return; }
      daemon?.send(JSON.stringify({ type: "session_available", sessionId, agentType: "nonexistent-fixture-provider", workingDirectory: temp }));
      res.end(JSON.stringify({ sessionId })); return;
    }
    if (req.headers.authorization !== "Bearer fixture-key") { res.writeHead(401); res.end('{}'); return; }
    res.end(req.url?.startsWith("/api/v1/runs") ? "[]" : "{}");
  });
  const gateway = new WebSocketServer({ server: http, path: "/sessions" });
  gateway.on("connection", (peer) => peer.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type === "hello") {
      if (msg.token !== "fixture-key" || msg.workspaceId !== "workspace") { peer.close(); return; }
      daemon = peer;
      peer.send(JSON.stringify({ type: "hello_ok", userId: "alice", heartbeatIntervalMs: 30000, gatewayTime: new Date().toISOString() }));
      connected();
    }
    if (msg.type === "session_claimed") claimed(msg.sessionId);
  }));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const mode = readDesktopMode({ ...settings, BOB_DESKTOP_APP_URL: origin, BOB_DESKTOP_GATEWAY_URL: origin.replace("http:", "ws:") + "/sessions", BOB_DESKTOP_DEV_DIR: temp }) as ConnectedDesktop;
  const configPath = path.join(temp, "config.json");
  await writeFile(configPath, daemonConfig(mode), { mode: 0o600 });
  // Empty inherited environment prevents provider/Forge CLI discovery from
  // finding real executables or credentials. All traffic targets this fixture.
  const child = spawn(binary, daemonArgs(mode, configPath), { cwd: temp, env: daemonEnvironment(mode, {}), detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.resume(); child.stderr?.resume();
  try {
    await connectedPromise;
    expect(await (await fetch(`${mode.appUrl}/api/sessions`, { method: "POST", headers: { cookie: "fixture_session=alice" } })).json()).toEqual({ sessionId });
    expect(await claimPromise).toBe(sessionId);
  } finally {
    await terminateProcessTree(child, { graceMs: 100 });
    for (const client of gateway.clients) client.terminate();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve()));
    await rm(temp, { recursive: true, force: true });
  }
}, 15_000);
