import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recordBobSessionOutcome } from "./skillfleet-workflow";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("recordBobSessionOutcome", () => {
  it("writes a privacy-safe terminal run using the normalized provider runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bob-skillfleet-"));
    temporaryDirectories.push(directory);
    const journalPath = join(directory, "bob.jsonl");

    const result = await recordBobSessionOutcome({
      sessionId: "raw-session-123",
      projectId: "/Volumes/dev/private-project",
      agentType: "claude-code",
      status: "success",
      durationMs: 321,
      observedAt: "2026-08-17T12:00:00.000Z",
    }, { journalPath });

    expect(result.state).toBe("written");
    const serialized = readFileSync(journalPath, "utf8");
    const record = JSON.parse(serialized.trim()) as Record<string, unknown>;
    expect(record).toMatchObject({
      source: "bob",
      observedAt: "2026-08-17T12:00:00.000Z",
      provenanceQuality: "direct",
      kind: "agent_run",
      payload: {
        runtime: "claude",
        status: "success",
        durationMs: 321,
        turnCount: 1,
      },
    });
    expect(serialized).not.toContain("raw-session-123");
    expect(serialized).not.toContain("/Volumes/dev/private-project");
    expect(record.sessionIdDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(record.projectIdDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("normalizes unknown providers and remains disabled without a journal", async () => {
    await expect(recordBobSessionOutcome({
      sessionId: "session",
      projectId: null,
      agentType: "future-agent",
      status: "failure",
      durationMs: 0,
      observedAt: "2026-08-17T12:00:00.000Z",
    }, { journalPath: null })).resolves.toEqual({ state: "disabled" });
  });
});
