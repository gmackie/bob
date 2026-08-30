/**
 * The latch is shared by three processes — the ooda-runner daemon, the task
 * runner, and the agent-health CLI — all pointed at the same state file so
 * they cannot disagree about a provider.
 *
 * They disagreed anyway. Each loaded the file once at construction, so a latch
 * written by the CLI was invisible to the long-lived daemon. On 2026-08-30
 * codex, cursor and claude were latched on the host while the node page went
 * on showing all three "Ready", because ooda-runner had read the file at
 * startup and never looked again.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileCreditStore } from "./credit-store.js";
import { RunOutcomeLatch } from "./credit.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "latch-reload-"));
  path = join(dir, "credit-state.json");
  process.env.BOB_CREDIT_STATE_PATH = path;
});

afterEach(() => {
  delete process.env.BOB_CREDIT_STATE_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("RunOutcomeLatch.reload", () => {
  it("picks up a latch another process wrote after construction", () => {
    const daemon = new RunOutcomeLatch(new FileCreditStore());
    expect(daemon.get("codex").kind).toBeUndefined();

    // The agent-health CLI, in its own process, records a real run failure.
    new RunOutcomeLatch(new FileCreditStore()).noteRunOutcome("codex", {
      code: 1,
      stderr: "401 Unauthorized",
    });

    daemon.reload();

    expect(daemon.get("codex").kind).toBe("auth");
  });

  it("picks up a clear written by another process", () => {
    const cli = new RunOutcomeLatch(new FileCreditStore());
    cli.noteRunOutcome("grok", { code: 1, stderr: "402 Payment Required" });

    const daemon = new RunOutcomeLatch(new FileCreditStore());
    expect(daemon.get("grok").kind).toBe("no_credit");

    // A successful run elsewhere clears it; the daemon must stop reporting it.
    cli.noteRunOutcome("grok", { code: 0, stdout: "ok" });
    daemon.reload();

    expect(daemon.get("grok").kind).toBeUndefined();
  });

  it("survives a corrupt state file rather than throwing", () => {
    const daemon = new RunOutcomeLatch(new FileCreditStore());
    writeFileSync(path, "{ not json");

    expect(() => daemon.reload()).not.toThrow();
  });

  it("is a no-op without a store", () => {
    const latch = new RunOutcomeLatch();
    latch.noteRunOutcome("grok", { code: 1, stderr: "402" });
    latch.reload();

    // Nothing to reload from, so the in-memory latch must survive.
    expect(latch.get("grok").kind).toBe("no_credit");
  });
});
