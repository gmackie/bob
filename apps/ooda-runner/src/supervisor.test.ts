import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  spawnSupervised,
  adoptSupervisedRun,
  writeConsumedOffset,
  journalLength,
  type RunMeta,
} from "./supervisor";

const META: RunMeta = {
  sessionId: "55555555-5555-4555-8555-555555555555",
  session: { sessionId: "55555555-5555-4555-8555-555555555555", agentType: "claude" },
  worktree: null,
  startedAt: new Date().toISOString(),
};

// A child that echoes stdin lines to stdout and exits when stdin closes.
const ECHO_CHILD = `
process.stdin.on('data', (d) => process.stdout.write('echo:' + d));
process.stdin.on('end', () => process.exit(0));
`;

// A child that prints once and hangs until killed.
const HANG_CHILD = `
process.stdout.write('started\\n');
setInterval(() => {}, 1000);
`;

// Generous ceiling: wrapper spawn pays node startup cost, which under a cold
// CI transform load has blown 5s before (see 3565faa4 for the lesson).
function waitFor(cond: () => boolean, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timeout"));
      setTimeout(tick, 50);
    };
    tick();
  });
}

describe("supervisor", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "supervisor-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs a child under the wrapper: stdin/stdout round-trip and clean exit", async () => {
    const proc = spawnSupervised(dir, META, process.execPath, ["-e", ECHO_CHILD], {
      cwd: process.cwd(),
      env: process.env,
    });

    const chunks: string[] = [];
    proc.stdout!.on("data", (d: Buffer) => chunks.push(d.toString()));
    let exitCode: number | null | undefined;
    proc.on("close", (code: number | null) => (exitCode = code));

    proc.stdin!.write("hello\n");
    await waitFor(() => chunks.join("").includes("echo:hello"));
    proc.stdin!.end();
    await waitFor(() => exitCode !== undefined);
    expect(exitCode).toBe(0);

    // The journal recorded the output and the exit.
    await waitFor(() => existsSync(join(dir, "output.jsonl")));
    const journal = readFileSync(join(dir, "output.jsonl"), "utf8");
    expect(journal).toContain('"ev":"exit"');
  });

  it("kill() terminates the child through the wrapper", async () => {
    const proc = spawnSupervised(dir, META, process.execPath, ["-e", HANG_CHILD], {
      cwd: process.cwd(),
      env: process.env,
    });
    const chunks: string[] = [];
    proc.stdout!.on("data", (d: Buffer) => chunks.push(d.toString()));
    await waitFor(() => chunks.join("").includes("started"));

    let closed = false;
    proc.on("close", () => (closed = true));
    proc.kill("SIGTERM");
    await waitFor(() => closed);
  });

  it("ignores control ops from a client that has not proven the token", async () => {
    const { createConnection } = await import("node:net");
    const proc = spawnSupervised(dir, META, process.execPath, ["-e", HANG_CHILD], {
      cwd: process.cwd(),
      env: process.env,
    });
    const chunks: string[] = [];
    proc.stdout!.on("data", (d: Buffer) => chunks.push(d.toString()));
    await waitFor(() => chunks.join("").includes("started"));
    let closed = false;
    proc.on("close", () => (closed = true));

    // The plaintext spawn config (env incl. secrets) must be unlinked once the
    // child is running — it should not linger on disk.
    expect(existsSync(join(dir, "spawn-config.json"))).toBe(false);

    // An unauthenticated raw client cannot kill the run: the wrapper requires a
    // proven token before honoring any control op.
    await new Promise<void>((resolve) => {
      const s = createConnection(join(dir, "ctl.sock"));
      s.on("connect", () => {
        s.write(JSON.stringify({ op: "kill", signal: "SIGKILL" }) + "\n");
        setTimeout(() => {
          s.destroy();
          resolve();
        }, 400);
      });
      s.on("error", () => resolve());
    });
    expect(closed).toBe(false); // the unauth'd kill was ignored

    // Positive control: the authenticated facade CAN stop it.
    proc.kill("SIGKILL");
    await waitFor(() => closed);
  });

  it("adoption: a live wrapper survives the facade going away and is re-adopted with journal replay", async () => {
    const proc = spawnSupervised(dir, META, process.execPath, ["-e", HANG_CHILD], {
      cwd: process.cwd(),
      env: process.env,
    });
    const chunks: string[] = [];
    proc.stdout!.on("data", (d: Buffer) => chunks.push(d.toString()));
    await waitFor(() => chunks.join("").includes("started"));

    // Simulate runner death: drop the facade (no kill!). The wrapper is
    // detached and keeps the child alive.
    // (We simply stop using `proc` — nothing holds the child's lifetime.)

    const adoption = await adoptSupervisedRun(dir);
    expect(adoption).not.toBeNull();
    expect(adoption!.kind).toBe("live");
    if (adoption!.kind !== "live") return;
    expect(adoption!.meta.sessionId).toBe(META.sessionId);
    expect(adoption!.consumed).toBe(0);

    // Subscribe from the consumed offset: the pre-restart 'started' output
    // arrives via the journal snapshot, then snapshot_end marks live.
    const adopted: string[] = [];
    let snapshotEnded = false;
    adoption!.proc.on("snapshot_end", () => (snapshotEnded = true));
    adoption!.proc.stdout!.on("data", (d: Buffer) => adopted.push(d.toString()));
    adoption!.proc.subscribe(adoption!.consumed);
    await waitFor(() => snapshotEnded);
    expect(adopted.join("")).toContain("started");

    // Clean up: kill through the adopted facade.
    let closed = false;
    adoption!.proc.on("close", () => (closed = true));
    adoption!.proc.kill("SIGTERM");
    await waitFor(() => closed);
  });

  it("adoption: a completed run is 'finished' via the journal (replay-before-reconcile)", async () => {
    const proc = spawnSupervised(
      dir,
      META,
      process.execPath,
      ["-e", "process.stdout.write('done\\n'); process.exit(0);"],
      { cwd: process.cwd(), env: process.env },
    );
    let exited = false;
    proc.on("close", () => (exited = true));
    await waitFor(() => exited);

    const adoption = await adoptSupervisedRun(dir);
    expect(adoption!.kind).toBe("finished");
    if (adoption!.kind !== "finished") return;
    expect(adoption!.exitCode).toBe(0);
    // The completion output is in the replay set — a crash between child
    // exit and runner ack can never lose the terminal outcome.
    expect(
      adoption!.replayed.some(
        (e) => e.ev === "data" && Buffer.from(e.b64!, "base64").toString().includes("done"),
      ),
    ).toBe(true);
  });

  it("adoption: dead wrapper with no exit line is 'orphaned'; stale token is never adopted", async () => {
    // Fabricate a run dir that looks like a wrapper died hard: meta + a
    // wrapper.json whose socket doesn't exist.
    writeFileSync(join(dir, "run-meta.json"), JSON.stringify(META));
    writeFileSync(
      join(dir, "wrapper.json"),
      JSON.stringify({ pid: 999999, childPid: 999998, token: "stale", startedAt: "x" }),
    );
    writeFileSync(
      join(dir, "output.jsonl"),
      JSON.stringify({ t: 1, ev: "data", stream: "stdout", b64: Buffer.from("partial").toString("base64") }) + "\n",
    );

    const adoption = await adoptSupervisedRun(dir);
    expect(adoption!.kind).toBe("orphaned");
    if (adoption!.kind === "live") return;
    expect(adoption!.replayed).toHaveLength(1);
  });

  it("consumed offset limits replay to unconsumed entries", async () => {
    const proc = spawnSupervised(
      dir,
      META,
      process.execPath,
      ["-e", "process.stdout.write('a\\n'); setTimeout(() => { process.stdout.write('b\\n'); process.exit(0); }, 200);"],
      { cwd: process.cwd(), env: process.env },
    );
    let exited = false;
    proc.on("close", () => (exited = true));
    await waitFor(() => exited);
    await waitFor(() => journalLength(dir) >= 2);

    // Mark the first entry consumed (already forwarded to the event buffer).
    writeConsumedOffset(dir, 1);

    const adoption = await adoptSupervisedRun(dir);
    expect(adoption!.kind).toBe("finished");
    if (adoption!.kind === "live") return;
    expect(adoption!.replayed.length).toBe(journalLength(dir) - 1);
  });
});
