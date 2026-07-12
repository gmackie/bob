import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SpawnedProcessLike } from "@gmacko/ooda/agent-adapters";

// =============================================================================
// Supervisor client — the runner's side of the detached-wrapper contract.
//
// spawnSupervised() launches supervisor-wrapper.cjs detached (own process
// group, ignored stdio) and returns a ChildProcess-shaped facade backed by
// the wrapper's unix socket, so adapters run unchanged via ExecuteOptions
// spawnImpl. The wrapper owns the agent child and journals all output; a
// runner restart re-adopts the live wrapper via adoptSupervisedRun().
//
// Stale-pid safety: adoption trusts only a connectable socket whose hello
// carries the token recorded in wrapper.json — a reused PID can't be adopted.
// =============================================================================

const WRAPPER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "supervisor-wrapper.cjs",
);

export interface RunMeta {
  sessionId: string;
  /** The dispatch context needed to finalize an adopted run. */
  session: Record<string, unknown>;
  worktree: { path: string; repoPath: string; branch: string; baseBranch: string } | null;
  startedAt: string;
}

interface JournalEntry {
  t: number;
  ev: "data" | "exit";
  stream?: "stdout" | "stderr";
  b64?: string;
  exitCode?: number | null;
  signal?: string | null;
}

/**
 * ChildProcess-shaped facade over the wrapper socket. Writes issued before
 * the socket connects are queued — spawnImpl is synchronous but the wrapper
 * needs a beat to create its socket.
 */
export class SupervisedProcess extends EventEmitter implements SpawnedProcessLike {
  exitCode: number | null = null;
  signalCode: string | null = null;

  private socket: Socket | null = null;
  private pendingOps: string[] = [];
  private closedEmitted = false;
  private stdinEnded = false;
  private readonly stdoutEmitter = new EventEmitter();
  private readonly stderrEmitter = new EventEmitter();

  readonly stdin = {
    write: (data: string): boolean => {
      if (this.stdinEnded) return false;
      this.sendOp({ op: "stdin", data });
      return true;
    },
    end: (): void => {
      this.stdinEnded = true;
      this.sendOp({ op: "end-stdin" });
    },
    get destroyed(): boolean {
      return false;
    },
    on: (_event: "error", _cb: (err: Error) => void): void => {
      /* stdin errors surface via the wrapper's stderr journal */
    },
  };

  readonly stdout = {
    on: (event: "data", cb: (data: Buffer) => void) =>
      void this.stdoutEmitter.on(event, cb),
  };
  readonly stderr = {
    on: (event: "data", cb: (data: Buffer) => void) =>
      void this.stderrEmitter.on(event, cb),
  };

  kill(signal?: string): void {
    this.sendOp({ op: "kill", ...(signal ? { signal } : {}) });
  }

  /**
   * Request the journal from `fromEntry` followed by live events. Until this
   * is called the wrapper sends nothing but its hello — output produced
   * before the socket connected is delivered by the snapshot, so nothing is
   * ever lost to the connect race. A "snapshot_end" event (with the journal
   * entry count) marks the replay/live boundary.
   */
  subscribe(fromEntry: number): void {
    this.sendOp({ op: "subscribe", fromEntry });
  }

  /** @internal */
  attachSocket(socket: Socket): void {
    this.socket = socket;
    for (const line of this.pendingOps) socket.write(line);
    this.pendingOps = [];

    let buf = "";
    socket.on("data", (data) => {
      buf += data.toString();
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          this.handleWrapperMessage(JSON.parse(line) as Record<string, unknown>);
        } catch {
          /* malformed line */
        }
      }
    });
    socket.on("error", () => this.emitCloseFromDisconnect());
    socket.on("close", () => this.emitCloseFromDisconnect());
  }

  /** @internal */
  failSpawn(err: Error): void {
    this.emit("error", err);
    this.emitClose(1, null);
  }

  /** @internal */
  emitClose(exitCode: number | null, signal: string | null): void {
    if (this.closedEmitted) return;
    this.closedEmitted = true;
    this.exitCode = exitCode ?? (signal ? null : 1);
    this.signalCode = signal;
    this.emit("close", exitCode);
  }

  /** @internal Replay a journal entry as if it just streamed. */
  replayEntry(entry: JournalEntry): void {
    this.handleWrapperMessage(entry as unknown as Record<string, unknown>);
  }

  private handleWrapperMessage(msg: Record<string, unknown>): void {
    if (msg.ev === "data" && typeof msg.b64 === "string") {
      const data = Buffer.from(msg.b64, "base64");
      if (msg.stream === "stderr") this.stderrEmitter.emit("data", data);
      else this.stdoutEmitter.emit("data", data);
    } else if (msg.ev === "exit") {
      this.emitClose(
        (msg.exitCode as number | null) ?? null,
        (msg.signal as string | null) ?? null,
      );
    } else if (msg.ev === "snapshot_end") {
      this.emit("snapshot_end", (msg.count as number) ?? 0);
    } else if (msg.ev === "hello" && msg.running === false) {
      // Connected after the child already exited (adoption race): the exit
      // line is in the journal; the caller replays it. Nothing to do live.
    }
  }

  private emitCloseFromDisconnect(): void {
    // Socket loss without an exit event: the wrapper died (crash/kill -9 of
    // the wrapper itself). The child's fate is unknown from here — treat as
    // an abnormal close; reconciliation reads the journal for the truth.
    if (!this.closedEmitted) this.emitClose(null, "SIGKILL");
  }

  private sendOp(op: Record<string, unknown>): void {
    const line = JSON.stringify(op) + "\n";
    if (this.socket && !this.socket.destroyed) this.socket.write(line);
    else this.pendingOps.push(line);
  }
}

function connectWithRetry(
  sockPath: string,
  proc: SupervisedProcess,
  attemptsLeft: number,
): void {
  const socket = createConnection(sockPath);
  socket.once("connect", () => proc.attachSocket(socket));
  socket.once("error", (err) => {
    socket.destroy();
    if (attemptsLeft > 0) {
      setTimeout(() => connectWithRetry(sockPath, proc, attemptsLeft - 1), 100);
    } else {
      proc.failSpawn(new Error(`supervisor socket never came up: ${err.message}`));
    }
  });
}

/**
 * Launch a supervised agent process. The runner writes meta + spawn config
 * into runDir, starts the wrapper detached, and gets back a ChildProcess
 * facade suitable for ExecuteOptions.spawnImpl.
 */
export function spawnSupervised(
  runDir: string,
  meta: RunMeta,
  binary: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string | undefined> },
): SpawnedProcessLike {
  mkdirSync(runDir, { recursive: true });
  // Spawn config carries the full env (API keys included) — owner-only.
  writeFileSync(
    join(runDir, "spawn-config.json"),
    JSON.stringify({ binary, args, cwd: opts.cwd, env: opts.env }),
    { mode: 0o600 },
  );
  writeFileSync(join(runDir, "run-meta.json"), JSON.stringify(meta), { mode: 0o600 });

  const wrapper = spawn(process.execPath, [WRAPPER_PATH, "--run-dir", runDir], {
    detached: true,
    stdio: "ignore",
  });
  wrapper.unref();

  const proc = new SupervisedProcess();
  // Fresh run: subscribe from entry 0 so even output the child produces
  // before our socket lands is delivered (via the journal snapshot).
  proc.subscribe(0);
  connectWithRetry(join(runDir, "ctl.sock"), proc, 50);
  return proc;
}

export type AdoptionResult =
  | {
      /** Wrapper alive, token verified: subscribe(consumed) to resume. */
      kind: "live";
      proc: SupervisedProcess;
      meta: RunMeta;
      consumed: number;
    }
  | { kind: "finished"; meta: RunMeta; exitCode: number | null; signal: string | null; replayed: JournalEntry[] }
  | { kind: "orphaned"; meta: RunMeta; replayed: JournalEntry[] };

function readJournal(runDir: string): JournalEntry[] {
  const path = join(runDir, "output.jsonl");
  if (!existsSync(path)) return [];
  const out: JournalEntry[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as JournalEntry);
    } catch {
      /* torn tail line */
    }
  }
  return out;
}

/**
 * Re-adopt a run after a runner restart.
 *
 * - Wrapper socket connects AND its hello token matches wrapper.json →
 *   "live": the run continues; journal entries past `consumedOffset` are
 *   replayed so no output is lost across the restart.
 * - Journal ends with an exit line → "finished": apply the terminal outcome
 *   (this is replay-before-reconcile: a completion that landed before the
 *   crash is honored, never orphan-marked).
 * - Neither → "orphaned": the wrapper died with the runner generation that
 *   spawned it (or a stale pidfile points at a reused PID); the run is
 *   reported interrupted.
 */
export async function adoptSupervisedRun(runDir: string): Promise<AdoptionResult | null> {
  const metaPath = join(runDir, "run-meta.json");
  if (!existsSync(metaPath)) return null;
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as RunMeta;

  const consumedPath = join(runDir, "consumed.offset");
  const consumed = existsSync(consumedPath)
    ? Number(readFileSync(consumedPath, "utf8")) || 0
    : 0;
  const journal = readJournal(runDir);
  const replayed = journal.slice(consumed);

  const wrapperInfoPath = join(runDir, "wrapper.json");
  const wrapperInfo = existsSync(wrapperInfoPath)
    ? (JSON.parse(readFileSync(wrapperInfoPath, "utf8")) as { token?: string })
    : null;

  const sockPath = join(runDir, "ctl.sock");
  if (wrapperInfo && existsSync(sockPath)) {
    const live = await new Promise<{ socket: Socket; hello: Record<string, unknown> } | null>(
      (resolve) => {
        const socket = createConnection(sockPath);
        const timeout = setTimeout(() => {
          socket.destroy();
          resolve(null);
        }, 2000);
        socket.once("error", () => {
          clearTimeout(timeout);
          resolve(null);
        });
        socket.once("data", (data) => {
          clearTimeout(timeout);
          try {
            const hello = JSON.parse(data.toString().split("\n")[0]!) as Record<string, unknown>;
            resolve({ socket, hello });
          } catch {
            socket.destroy();
            resolve(null);
          }
        });
      },
    );

    if (live) {
      // Stale-pid safety: the socket must speak with the recorded token.
      if (live.hello.token !== wrapperInfo.token) {
        live.socket.destroy();
        return { kind: "orphaned", meta, replayed };
      }
      if (live.hello.running === true) {
        const proc = new SupervisedProcess();
        proc.attachSocket(live.socket);
        return { kind: "live", proc, meta, consumed };
      }
      live.socket.destroy();
    }
  }

  const exitEntry = journal.find((e) => e.ev === "exit");
  if (exitEntry) {
    return {
      kind: "finished",
      meta,
      exitCode: exitEntry.exitCode ?? null,
      signal: exitEntry.signal ?? null,
      replayed,
    };
  }
  return { kind: "orphaned", meta, replayed };
}

/** Record how many journal entries have been handed to the durable buffer. */
export function writeConsumedOffset(runDir: string, entries: number): void {
  writeFileSync(join(runDir, "consumed.offset"), String(entries));
}

export function journalLength(runDir: string): number {
  return readJournal(runDir).length;
}
