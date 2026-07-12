#!/usr/bin/env node
// =============================================================================
// supervisor-wrapper — detached process supervisor for agent runs.
//
// Spawned by the runner with `node supervisor-wrapper.cjs --run-dir <dir>`,
// detached from the runner's process group so it (and the agent child it
// owns) survives runner restarts and deploys. A blocked run waiting hours for
// an approval no longer dies because the runner was redeployed.
//
// Plain CommonJS on purpose: it must run under bare `node` with zero deps and
// zero build step, whatever runtime (tsx, dist) the runner itself uses.
//
// Files in <run-dir>:
//   spawn-config.json  — {binary, args, cwd, env} written by the runner (0600)
//   wrapper.json       — {pid, childPid, token, startedAt} written by us
//   output.jsonl       — journal: {t, ev:"data", stream, b64} / {t, ev:"exit", exitCode, signal}
//   ctl.sock           — unix socket; JSON-lines control protocol:
//     client → wrapper: {op:"subscribe", fromEntry} | {op:"stdin", data}
//                       | {op:"end-stdin"} | {op:"kill", signal?}
//     wrapper → client: {ev:"hello", pid, childPid, running, exitCode, token}
//                       {ev:"data", stream, b64} | {ev:"exit", exitCode, signal}
//                       {ev:"snapshot_end", count}
//
// A client receives NOTHING but hello until it subscribes; subscribe streams
// the journal from `fromEntry` (so output produced before the client
// connected — or before a runner restart — is never lost), marks the end
// with snapshot_end, then live events flow. Node's single-threaded event
// loop makes snapshot-then-live gap-free: the subscribe handler runs to
// completion before any new child data event can fire.
//
// The journal is the durable record (adoption of finished runs never needs
// the wrapper alive); the socket is the live channel. The wrapper exits
// LINGER_MS after the child does — by then the exit line is on disk.
// =============================================================================

"use strict";

const { spawn } = require("node:child_process");
const { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } = require("node:fs");
const net = require("node:net");
const { join } = require("node:path");
const crypto = require("node:crypto");

const KILL_GRACE_MS = 5000;
const LINGER_MS = Number(process.env.BOB_SUPERVISOR_LINGER_MS || 10000);

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const runDir = argValue("--run-dir");
if (!runDir) {
  process.stderr.write("supervisor-wrapper: --run-dir is required\n");
  process.exit(2);
}
mkdirSync(runDir, { recursive: true });

const config = JSON.parse(readFileSync(join(runDir, "spawn-config.json"), "utf8"));
const journalPath = join(runDir, "output.jsonl");
const sockPath = join(runDir, "ctl.sock");
const token = crypto.randomBytes(16).toString("hex");

let childExit = null; // {exitCode, signal} once the child exits

const child = spawn(config.binary, config.args, {
  cwd: config.cwd,
  env: config.env,
  stdio: ["pipe", "pipe", "pipe"],
});

writeFileSync(
  join(runDir, "wrapper.json"),
  JSON.stringify({
    pid: process.pid,
    childPid: child.pid,
    token,
    startedAt: new Date().toISOString(),
  }),
);

// Only subscribed clients receive live events — a client's snapshot must
// finish before live data may reach it, or ordering breaks.
const clients = new Set();
let journalCount = 0;

function journal(entry) {
  try {
    appendFileSync(journalPath, JSON.stringify(entry) + "\n");
    journalCount += 1;
  } catch {
    /* disk trouble: live streaming still works */
  }
}

function readJournalLines() {
  try {
    return readFileSync(journalPath, "utf8").split("\n").filter((l) => l.trim());
  } catch {
    return [];
  }
}

function broadcast(msg) {
  const line = JSON.stringify(msg) + "\n";
  for (const c of clients) {
    try {
      c.write(line);
    } catch {
      clients.delete(c);
    }
  }
}

function onData(stream) {
  return (data) => {
    const b64 = data.toString("base64");
    journal({ t: Date.now(), ev: "data", stream, b64 });
    broadcast({ ev: "data", stream, b64 });
  };
}

child.stdout.on("data", onData("stdout"));
child.stderr.on("data", onData("stderr"));
child.on("error", (err) => {
  journal({ t: Date.now(), ev: "data", stream: "stderr", b64: Buffer.from(`spawn error: ${err.message}\n`).toString("base64") });
});
child.on("close", (exitCode, signal) => {
  childExit = { exitCode, signal: signal || null };
  journal({ t: Date.now(), ev: "exit", exitCode, signal: signal || null });
  broadcast({ ev: "exit", exitCode, signal: signal || null });
  // Give a (re)connecting runner a moment to hear the exit live, then go.
  setTimeout(() => {
    try {
      unlinkSync(sockPath);
    } catch {
      /* already gone */
    }
    process.exit(0);
  }, LINGER_MS).unref();
});

function killChild(signal) {
  try {
    child.kill(signal || "SIGTERM");
  } catch {
    return;
  }
  setTimeout(() => {
    if (childExit === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* gone */
      }
    }
  }, KILL_GRACE_MS).unref();
}

if (existsSync(sockPath)) {
  try {
    unlinkSync(sockPath);
  } catch {
    /* stale */
  }
}

const server = net.createServer((socket) => {
  socket.write(
    JSON.stringify({
      ev: "hello",
      pid: process.pid,
      childPid: child.pid,
      running: childExit === null,
      exitCode: childExit ? childExit.exitCode : null,
      token,
    }) + "\n",
  );

  let buf = "";
  socket.on("data", (data) => {
    buf += data.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.op === "subscribe") {
        const from = typeof msg.fromEntry === "number" ? msg.fromEntry : 0;
        const lines = readJournalLines();
        for (const l of lines.slice(from)) {
          try {
            socket.write(l + "\n");
          } catch {
            break;
          }
        }
        try {
          socket.write(JSON.stringify({ ev: "snapshot_end", count: lines.length }) + "\n");
        } catch {
          /* client went away mid-snapshot */
        }
        clients.add(socket);
      } else if (msg.op === "stdin" && typeof msg.data === "string") {
        try {
          child.stdin.write(msg.data);
        } catch {
          /* stdin gone */
        }
      } else if (msg.op === "end-stdin") {
        try {
          child.stdin.end();
        } catch {
          /* already ended */
        }
      } else if (msg.op === "kill") {
        killChild(msg.signal);
      }
    }
  });
  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

server.listen(sockPath);
server.on("error", (err) => {
  process.stderr.write(`supervisor-wrapper: socket error: ${err.message}\n`);
});

// Never die with the runner: ignore terminal-session signals; the child is
// stopped only by an explicit {op:"kill"} or its own exit.
process.on("SIGHUP", () => {});
