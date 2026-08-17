import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { emitSkillfleetWorkflowEvent } from "./journal";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixturePath() {
  const root = await mkdtemp(join(tmpdir(), "gmacko-skillfleet-"));
  roots.push(root);
  return { root, journalPath: join(root, "private", "workflow.jsonl") };
}

function input() {
  return {
    source: "bob" as const,
    identity: "raw-task-run-123",
    observedAt: "2026-08-17T17:30:00.000Z",
    sessionId: "raw-session-456",
    projectId: "raw-project-789",
    provenanceQuality: "direct" as const,
    kind: "agent_run" as const,
    payload: { runtime: "codex" as const, status: "success" as const, durationMs: 1_500, turnCount: 3 },
  };
}

describe("Skillfleet workflow journal", () => {
  it("is a no-op when no explicit journal path is configured", async () => {
    await expect(emitSkillfleetWorkflowEvent(input(), { journalPath: null }))
      .resolves.toEqual({ state: "disabled" });
  });

  it("hashes raw identities and appends one mode-safe normalized line", async () => {
    const { root, journalPath } = await fixturePath();

    const result = await emitSkillfleetWorkflowEvent(input(), { journalPath });
    const serialized = await readFile(journalPath, "utf8");
    const record = JSON.parse(serialized.trim());

    expect(result).toEqual({ state: "written", recordId: record.recordId });
    expect(record).toMatchObject({
      schemaVersion: 1,
      source: "bob",
      observedAt: input().observedAt,
      provenanceQuality: "direct",
      kind: "agent_run",
      payload: input().payload,
    });
    expect(record.recordId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(record.sessionIdDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(record.projectIdDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    for (const privateValue of [input().identity, input().sessionId, input().projectId, root]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect((await lstat(join(root, "private"))).mode & 0o777).toBe(0o700);
    expect((await lstat(journalPath)).mode & 0o777).toBe(0o600);
  });

  it("rejects content-bearing fields and isolates write failures from callers", async () => {
    const { root, journalPath } = await fixturePath();
    await expect(emitSkillfleetWorkflowEvent({ ...input(), prompt: "private" } as never, { journalPath }))
      .resolves.toEqual({ state: "rejected" });
    await expect(emitSkillfleetWorkflowEvent(input(), { journalPath: root }))
      .resolves.toEqual({ state: "failed" });
  });
});
