#!/usr/bin/env node
// Self-contained ACP smoke test for Grok Build (no repo deps).
// Spawns `grok agent stdio` and drives initialize -> session/new ->
// session/prompt, logging every inbound message so we can verify the
// real protocol shapes against the GrokAdapter mapping. Then checks the
// agent actually created a file in the workspace.
//
// Usage (as the user that has grok + XAI_API_KEY):
//   node grok-acp-smoke.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GROK = process.env.GROK_BIN || "grok";
const workspace = mkdtempSync(join(tmpdir(), "grok-smoke-"));
const TARGET = "hello.txt";
const MARKER = "hello from grok acp";

console.log(`[smoke] workspace: ${workspace}`);
console.log(`[smoke] launching: ${GROK} agent stdio`);

const child = spawn(
  GROK,
  ["--cwd", workspace, "agent", "--always-approve", "stdio"],
  { cwd: workspace, env: process.env, stdio: ["pipe", "pipe", "pipe"] },
);

let nextId = 1;
const pending = new Map();
let buffer = "";

function send(obj) {
  console.log(`[smoke] -> ${JSON.stringify(obj)}`);
  child.stdin.write(JSON.stringify(obj) + "\n");
}

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function answer(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function handle(msg) {
  const hasId = typeof msg.id === "number";
  const hasMethod = typeof msg.method === "string";

  if (hasId && !hasMethod) {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
    return;
  }

  if (hasId && hasMethod) {
    // Agent -> client request. Log the FULL shape, then answer.
    console.log(`[smoke] <REQ ${msg.method}> ${JSON.stringify(msg.params)}`);
    if (msg.method === "fs/read_text_file") {
      const path = msg.params?.path ?? "";
      const abs = path.startsWith("/") ? path : join(workspace, path);
      answer(msg.id, { content: existsSync(abs) ? readFileSync(abs, "utf8") : "" });
    } else if (msg.method === "fs/write_text_file") {
      const path = msg.params?.path ?? "";
      const abs = path.startsWith("/") ? path : join(workspace, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, msg.params?.content ?? "", "utf8");
      answer(msg.id, null);
    } else if (msg.method === "session/request_permission") {
      const opts = msg.params?.options ?? [];
      const allow = opts.find((o) => String(o.kind || "").startsWith("allow")) ?? opts[0];
      answer(msg.id, { outcome: { outcome: "selected", optionId: allow?.optionId } });
    } else {
      answer(msg.id, null);
    }
    return;
  }

  if (hasMethod) {
    // Notification — the shapes we care about for mapSessionUpdate.
    console.log(`[smoke] <NOTIFY ${msg.method}> ${JSON.stringify(msg.params)}`);
  }
}

child.stdout.on("data", (d) => {
  buffer += d.toString();
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch {
      console.log(`[smoke] <non-json stdout> ${line}`);
    }
  }
});
child.stderr.on("data", (d) => console.log(`[smoke] <stderr> ${d.toString().trimEnd()}`));
child.on("error", (e) => { console.error("[smoke] spawn error:", e.message); process.exit(2); });

const fail = (msg) => { console.error(`[smoke] FAIL: ${msg}`); try { child.kill("SIGKILL"); } catch {} process.exit(1); };
const overall = setTimeout(() => fail("overall timeout (120s)"), 120_000);

try {
  const init = await request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
  });
  console.log(`[smoke] initialize result: ${JSON.stringify(init)}`);

  const authMethods = init?.authMethods ?? [];
  if (!process.env.XAI_API_KEY && authMethods.length > 0) {
    const first = authMethods[0];
    await request("authenticate", { methodId: typeof first === "string" ? first : first?.id });
  }

  const session = await request("session/new", { cwd: workspace, mcpServers: [] });
  console.log(`[smoke] session/new result: ${JSON.stringify(session)}`);
  const sessionId = session?.sessionId;

  const prompt = await request("session/prompt", {
    sessionId,
    prompt: [
      {
        type: "text",
        text: `Create a file named ${TARGET} in the current directory containing exactly this text: ${MARKER}\nThen stop.`,
      },
    ],
  });
  console.log(`[smoke] session/prompt result: ${JSON.stringify(prompt)}`);

  clearTimeout(overall);
  child.stdin.end();

  const abs = join(workspace, TARGET);
  console.log(`[smoke] workspace contents: ${JSON.stringify(readdirSync(workspace))}`);
  if (!existsSync(abs)) fail(`expected file not created: ${abs}`);
  const content = readFileSync(abs, "utf8");
  console.log(`[smoke] ${TARGET} content: ${JSON.stringify(content)}`);
  if (!content.includes(MARKER)) fail(`file missing marker text`);

  console.log("[smoke] PASS ✅  ACP handshake + prompt + file write all worked");
  try { child.kill("SIGTERM"); } catch {}
  process.exit(0);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
