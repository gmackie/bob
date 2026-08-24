import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { recordBobSessionOutcome } from "./skillfleet-workflow";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function journal() {
  const dir = await mkdtemp(join(tmpdir(), "bob-skillfleet-"));
  dirs.push(dir);
  return join(dir, "workflows.jsonl");
}

const outcome = {
  sessionId: "session-1",
  projectId: "project-1",
  agentType: "claude",
  status: "success" as const,
  durationMs: 1_200,
  observedAt: "2026-08-23T12:00:00.000Z",
};

describe("recordBobSessionOutcome", () => {
  // This daemon runs Bob's own work. The OODA runner's thread path reports
  // source "ooda"; the collector validates source per adapter and silently
  // drops mismatches, so tagging this "ooda" would discard every Bob record.
  it("tags Bob's task execution as bob-sourced", async () => {
    const journalPath = await journal();
    const result = await recordBobSessionOutcome(outcome, { journalPath });

    expect(result.state).toBe("written");
    const record = JSON.parse(readFileSync(journalPath, "utf8").trim());
    expect(record).toMatchObject({
      source: "bob",
      kind: "agent_run",
      payload: { runtime: "claude", status: "success", turnCount: 1 },
    });
  });

  it("digests the session and project rather than writing them in clear", async () => {
    const journalPath = await journal();
    await recordBobSessionOutcome(outcome, { journalPath });

    const serialized = readFileSync(journalPath, "utf8");
    expect(serialized).not.toContain("session-1");
    expect(serialized).not.toContain("project-1");
    expect(JSON.parse(serialized.trim()).sessionIdDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });

  it("records a failed session", async () => {
    const journalPath = await journal();
    await recordBobSessionOutcome(
      { ...outcome, status: "failure" },
      { journalPath },
    );
    expect(
      JSON.parse(readFileSync(journalPath, "utf8").trim()).payload.status,
    ).toBe("failure");
  });

  // The reason this is safe to land: with nothing configured the emitter
  // short-circuits before touching the filesystem, so a live daemon is
  // unchanged until someone opts in.
  it("writes nothing when the journal is unconfigured", async () => {
    const journalPath = await journal();
    const result = await recordBobSessionOutcome(outcome, {
      journalPath: null,
    });

    expect(result).toEqual({ state: "disabled" });
    expect(existsSync(journalPath)).toBe(false);
  });
});
