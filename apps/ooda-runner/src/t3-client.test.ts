import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { T3Client } from "./t3-client";
import { launchT3Task } from "./t3-bridge";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function server(options: { reject?: boolean; unauthorized?: boolean; bridge?: boolean } = {}) {
  let answered = false;
  let interrupted = false;
  const calls: { tag: string; payload: any }[] = [];
  const httpCalls: { path: string; auth?: string; protocol?: string; body: any }[] = [];
  const http: Server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    httpCalls.push({ path: req.url!, auth: req.headers.authorization, protocol: req.headers["x-t3-orchestration-protocol"] as string, body: body ? JSON.parse(body) : undefined });
    res.setHeader("content-type", "application/json");
    if (options.unauthorized) { res.writeHead(401); res.end('{}'); return; }
    res.end(JSON.stringify(req.url === "/api/projects" ? { projects: [{ id: "wrong", workspaceRoot: "/other-repo" }, { id: "right", workspaceRoot: "/repo" }] } : { ticket: "one-use-ticket" }));
  });
  const ws = new WebSocketServer({ server: http });
  ws.on("connection", (socket, req) => {
    expect(req.url).toBe("/ws?orchestrationProtocol=2&wsTicket=one-use-ticket");
    socket.on("message", data => {
      const request = JSON.parse(data.toString()); calls.push(request);
      if (request.payload.type === "runtime-request.respond") answered = true;
      if (request.payload.type === "run.interrupt") interrupted = true;
      const projection = { thread: { id: "t", projectId: "right", worktreePath: task.worktreePath },
        runs: [{ id: "run-1", ordinal: 1, status: interrupted ? "interrupted" : "running" }],
        turnItems: [{ id: "output", type: "assistant_message", text: "SERVER_OUTPUT", status: "completed" }],
        runtimeRequests: [{ id: "approval-1", kind: "command", status: answered ? "resolved" : "pending" }] };
      const value = request.tag === "server.getConfig" ? { providers: [{ instanceId: "codex", status: "ready", models: [{ slug: "server-default", isDefault: true }] }] } : request.tag === "orchestration.getThreadProjection" ? projection : { threadId: request.payload.threadId, projection: options.bridge ? projection : { runs: [] } };
      socket.send(JSON.stringify([{ _tag: "Exit", requestId: request.id, exit: options.reject ? { _tag: "Failure", cause: "private details" } : { _tag: "Success", value } }]));
    });
  });
  http.listen(0, "127.0.0.1"); await once(http, "listening");
  const address = http.address() as { port: number };
  cleanup.push(async () => { for (const client of ws.clients) client.terminate(); ws.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const config = { serverUrl: `http://127.0.0.1:${address.port}`, authToken: "private-token" };
  return { config, client: new T3Client(config), calls, httpCalls };
}
const task = { sessionId: "session-one", title: "BOB-40 smoke", repoPath: "/repo", worktreePath: "/work/repo/BOB-40", branch: "BOB-40", prompt: "Check the task", runtimeMode: "approval-required" as const };

it("launches in the matching repo/worktree using protocol 2 and stable retry identities", async () => {
  const fixture = await server();
  await launchT3Task(fixture.client, fixture.config, task);
  await launchT3Task(fixture.client, fixture.config, task);
  const launches = fixture.calls.filter(c => c.tag === "orchestration.launchThread");
  expect(launches).toHaveLength(2);
  expect(launches[0]!.payload).toEqual(launches[1]!.payload);
  expect(launches[0]!.payload).toMatchObject({ projectId: "right", modelSelection: { instanceId: "codex", model: "server-default" }, runtimeMode: "approval-required", workspaceStrategy: { type: "existing_worktree", worktreePath: task.worktreePath, branch: "BOB-40" }, initialMessage: { text: task.prompt } });
  expect(launches[0]!.payload).not.toHaveProperty("reuseExistingThread");
  expect(fixture.httpCalls.every(c => c.auth === "Bearer private-token" && c.protocol === "2")).toBe(true);
  expect(fixture.httpCalls.some(c => c.path === "/api/orchestration/dispatch")).toBe(false);
});
it("surfaces an authorization failure without starting a thread", async () => {
  const fixture = await server({ unauthorized: true });
  await expect(launchT3Task(fixture.client, fixture.config, task)).rejects.toThrow("HTTP 401");
  expect(fixture.calls).toHaveLength(0);
});
it("surfaces RPC rejection without exposing server configuration", async () => {
  const fixture = await server({ reject: true });
  await expect(fixture.client.rpc("server.getConfig", {})).rejects.toThrow("request rejected");
});

it("streams output, responds to permission/input, and confirms remote interruption before exiting", async () => {
  const fixture = await server({ bridge: true });
  const child = spawn(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), fileURLToPath(new URL("./t3-bridge.ts", import.meta.url))], {
    env: { ...process.env, BOB_T3_CONFIG: JSON.stringify(fixture.config), BOB_T3_TASK: JSON.stringify(task) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  cleanup.push(async () => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let output = "";
  let sent = false;
  child.stdout.on("data", data => {
    output += String(data);
    if (!sent && output.includes("control_request")) {
      sent = true;
      child.stdin.write(JSON.stringify({ type: "control_response", response: { request_id: "approval-1", response: { behavior: "allow" } } }) + "\n");
      child.stdin.write(JSON.stringify({ type: "user", message: { content: "Follow-up from mobile" } }) + "\n");
      child.stdin.write(JSON.stringify({ type: "stop" }) + "\n");
    }
  });
  const [code] = await once(child, "exit");
  expect(code).toBe(0);
  expect(output).toContain("SERVER_OUTPUT");
  expect(output).toContain('"type":"control_resolved"');
  expect(output).toContain("T3 run interrupted");
  const commands = fixture.calls.filter(c => c.tag === "orchestration.dispatchCommand").map(c => c.payload);
  expect(commands).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "runtime-request.respond", requestId: "approval-1", decision: "accept" }),
    expect.objectContaining({ type: "message.dispatch", text: "Follow-up from mobile", dispatchMode: { type: "steer_active", targetRunId: "run-1" } }),
    expect.objectContaining({ type: "run.interrupt", runId: "run-1", holdQueue: true }),
  ]));
}, 15_000);
