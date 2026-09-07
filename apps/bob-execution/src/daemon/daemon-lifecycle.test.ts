import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { WebSocket } from "ws";
import { expect, it } from "vitest";
import { WebSocketServer } from "ws";

it("real daemon cancels setup, replays unacknowledged frames after reconnect, and confirms process exit before terminal status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bob-daemon-"));
  const source = join(dir, "source");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  execFileSync("git", ["init", "-q", source]);
  execFileSync("git", [
    "-C",
    source,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "base",
  ]);
  symlinkSync(process.execPath, join(bin, "node"));
  symlinkSync("/usr/bin/git", join(bin, "git"));
  writeFileSync(
    join(bin, "claude"),
    `#!/usr/bin/env node\nif(!process.argv.includes('--output-format'))process.exit(0);require('node:fs').writeFileSync(${JSON.stringify(join(dir, "spawned"))},String(process.pid));process.on('SIGTERM',()=>{});console.log('agent-ready');setInterval(()=>{},1000);`,
    { mode: 0o755 },
  );
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (typeof address === "string" || !address) throw Error("missing address");
  const frames: Record<string, unknown>[] = [];
  let socket: WebSocket | undefined;
  let connections = 0;
  let logs = "";
  const launch = () =>
    spawn(
      process.execPath,
      process.env.BOB_DAEMON_TEST_BUILT
        ? [process.env.BOB_DAEMON_TEST_ENTRY ?? resolve("dist/daemon/index.js")]
        : ["--import", "tsx", resolve("src/daemon/index.ts")],
      {
        cwd: process.cwd(),
        env: {
          PATH: bin,
          HOME: dir,
          BOB_API_KEY: "test-only",
          BOB_WORKSPACE_ID: "test-workspace",
          BOB_JOURNAL_DIR: join(dir, "journal"),
          GATEWAY_WS_URL: `ws://127.0.0.1:${address.port}`,
          OODA_ORACLE_ENABLED: "false",
          OTEL_SDK_DISABLED: "true",
          NODE_ENV: "test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  let child = launch();
  child.stdout.on("data", (d: Buffer) => {
    logs += d.toString();
  });
  child.stderr.on("data", (d: Buffer) => {
    logs += d.toString();
  });
  server.on("connection", (ws) => {
    socket = ws;
    connections++;
    ws.on("message", (data) => {
      const frame = JSON.parse(
        (Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer)
        ).toString(),
      ) as Record<string, unknown>;
      frames.push(frame);
      if (frame.type === "hello")
        ws.send(JSON.stringify({ type: "hello_ok", userId: "test" }));
    });
  });
  const wait = async (predicate: () => boolean) => {
    const end = Date.now() + 15_000;
    while (!predicate()) {
      if (Date.now() > end || child.exitCode !== null)
        throw Error(`daemon condition failed: ${logs}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const currentSocket = () => {
    if (!socket) throw Error("No connected socket");
    return socket;
  };
  const offer = (id: string) =>
    currentSocket().send(
      JSON.stringify({
        type: "session_available",
        sessionId: id,
        workingDirectory: source,
        agentType: "claude",
        title: "fixture",
      }),
    );
  try {
    await wait(() => frames.some((f) => f.type === "hello"));
    offer("setup");
    currentSocket().send(
      JSON.stringify({ type: "session_stop", sessionId: "setup" }),
    );
    await wait(() =>
      frames.some((f) => f.sessionId === "setup" && f.status === "interrupted"),
    );
    expect(existsSync(join(dir, "spawned"))).toBe(false);
    offer("running");
    await wait(() =>
      frames.some(
        (f) => f.sessionId === "running" && f.eventType === "output_chunk",
      ),
    );
    const original = frames.find(
      (f) => f.sessionId === "running" && f.eventType === "output_chunk",
    );
    currentSocket().terminate();
    await wait(() => connections === 2);
    await wait(
      () =>
        frames.filter(
          (f) => f.sessionId === "running" && f.sendSeq === original?.sendSeq,
        ).length === 2,
    );
    currentSocket().send(
      JSON.stringify({ type: "session_stop", sessionId: "running" }),
    );
    await wait(() =>
      frames.some(
        (f) => f.sessionId === "running" && f.status === "interrupted",
      ),
    );
    expect(
      frames
        .filter(
          (f) =>
            f.sessionId === "running" &&
            ["completed", "error", "interrupted"].includes(String(f.status)),
        )
        .map((f) => f.status),
    ).toEqual(["interrupted"]);
    offer("running");
    await new Promise((r) => setTimeout(r, 100));
    expect(
      frames.filter(
        (f) =>
          f.sessionId === "running" &&
          f.type === "session_status" &&
          f.status === "starting",
      ),
    ).toHaveLength(2);
    offer("crash");
    await wait(() =>
      frames.some(
        (f) => f.sessionId === "crash" && f.eventType === "output_chunk",
      ),
    );
    for (const frame of frames.filter(
      (f) => f.sessionId === "crash" && typeof f.sendSeq === "number",
    ))
      currentSocket().send(
        JSON.stringify({
          type: "event_ack",
          sessionId: "crash",
          sendSeq: frame.sendSeq,
        }),
      );
    const rows = (table: "frames" | "active") => {
      const inspect = new DatabaseSync(join(dir, "journal", "journal.sqlite"));
      inspect.exec("PRAGMA busy_timeout=5000");
      try {
        return Number(
          inspect
            .prepare(
              `SELECT count(*) AS n FROM ${table} WHERE sessionId='crash'`,
            )
            .get()?.n ?? 0,
        );
      } finally {
        inspect.close();
      }
    };
    await wait(() => rows("frames") === 0);
    expect(rows("active")).toBe(1);
    child.kill("SIGKILL");
    await once(child, "exit");
    child = launch();
    child.stdout.on("data", (d: Buffer) => {
      logs += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      logs += d.toString();
    });
    await wait(() =>
      frames.some((f) => f.sessionId === "crash" && f.status === "interrupted"),
    );
    expect(
      frames
        .filter(
          (f) =>
            f.sessionId === "crash" &&
            ["completed", "error", "interrupted"].includes(String(f.status)),
        )
        .map((f) => f.status),
    ).toEqual(["interrupted"]);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    for (const ws of server.clients) ws.terminate();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
}, 45_000);
