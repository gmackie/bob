import { readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { emitSkillfleetWorkflowEvent } from "../skillfleet-journal";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("standalone Skillfleet journal compatibility", () => {
  it("emits the exact v1 digest-only record contract", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ooda-skillfleet-"));
    temporaryDirectories.push(directory);
    const journalPath = join(directory, "workflows.jsonl");

    const result = await emitSkillfleetWorkflowEvent(
      {
        source: "ooda",
        identity: "raw-event",
        observedAt: "2026-08-17T12:00:00.000Z",
        sessionId: "raw-session",
        projectId: "/private/project",
        provenanceQuality: "direct",
        kind: "agent_run",
        payload: {
          runtime: "codex",
          status: "success",
          durationMs: 20,
          turnCount: 1,
        },
      },
      { journalPath },
    );

    expect(result.state).toBe("written");
    const serialized = readFileSync(journalPath, "utf8");
    const record = JSON.parse(serialized.trim());
    expect(Object.keys(record).sort()).toEqual(
      [
        "kind",
        "observedAt",
        "payload",
        "projectIdDigest",
        "provenanceQuality",
        "recordId",
        "schemaVersion",
        "sessionIdDigest",
        "source",
      ].sort(),
    );
    expect(record).toMatchObject({
      schemaVersion: 1,
      source: "ooda",
      kind: "agent_run",
      payload: {
        runtime: "codex",
        status: "success",
        durationMs: 20,
        turnCount: 1,
      },
    });
    expect(record.recordId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(record.sessionIdDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(record.projectIdDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(serialized).not.toContain("raw-event");
    expect(serialized).not.toContain("raw-session");
    expect(serialized).not.toContain("/private/project");
    expect(statSync(journalPath).mode & 0o777).toBe(0o600);
  });

  it("is disabled when unconfigured and isolates invalid paths", async () => {
    const input = {
      source: "ooda" as const,
      identity: "event",
      observedAt: "2026-08-17T12:00:00.000Z",
      sessionId: null,
      projectId: null,
      provenanceQuality: "direct" as const,
      kind: "engineering_outcome" as const,
      payload: {
        outcomeType: "promotion" as const,
        result: "pass" as const,
        durationMs: 0,
      },
    };
    await expect(
      emitSkillfleetWorkflowEvent(input, { journalPath: null }),
    ).resolves.toEqual({ state: "disabled" });
    await expect(
      emitSkillfleetWorkflowEvent(input, { journalPath: "relative.jsonl" }),
    ).resolves.toEqual({ state: "failed" });
  });

  it("prefers the source-specific OODA journal over the legacy shared path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ooda-skillfleet-routing-"));
    temporaryDirectories.push(directory);
    const oodaJournal = join(directory, "ooda.jsonl");
    const legacyJournal = join(directory, "legacy.jsonl");
    const result = await emitSkillfleetWorkflowEvent({
      source: "ooda",
      identity: "event",
      observedAt: "2026-08-17T12:00:00.000Z",
      sessionId: null,
      projectId: null,
      provenanceQuality: "direct",
      kind: "engineering_outcome",
      payload: { outcomeType: "promotion", result: "pass", durationMs: 0 },
    }, { environment: {
      SKILLFLEET_OODA_WORKFLOW_JOURNAL: oodaJournal,
      SKILLFLEET_WORKFLOW_JOURNAL: legacyJournal,
    } });

    expect(result.state).toBe("written");
    expect(JSON.parse(readFileSync(oodaJournal, "utf8").trim()).source).toBe("ooda");
    expect(() => readFileSync(legacyJournal, "utf8")).toThrow();
  });
});

describe("fold safety guarantees", () => {
  const baseInput = {
    identity: "event",
    observedAt: "2026-08-17T12:00:00.000Z",
    sessionId: null,
    projectId: null,
    provenanceQuality: "direct" as const,
    kind: "agent_run" as const,
    payload: {
      runtime: "claude" as const,
      status: "success" as const,
      durationMs: 5,
      turnCount: 1,
    },
  };

  // The runner calls this on every session. Porting it into the fold is only
  // a no-op on the running system because an unconfigured environment short-
  // circuits before any filesystem work. The sibling suite pins the explicit
  // `journalPath: null` branch; this pins the env-fallback branch that the
  // live runner actually takes when nobody has opted in.
  it("stays disabled when neither option nor environment configures a path", async () => {
    await expect(
      emitSkillfleetWorkflowEvent(
        { ...baseInput, source: "ooda" },
        { environment: {} },
      ),
    ).resolves.toEqual({ state: "disabled" });

    await expect(
      emitSkillfleetWorkflowEvent(
        { ...baseInput, source: "ooda" },
        {
          environment: {
            SKILLFLEET_OODA_WORKFLOW_JOURNAL: "",
            SKILLFLEET_WORKFLOW_JOURNAL: "",
          },
        },
      ),
    ).resolves.toEqual({ state: "disabled" });
  });

  // Unlike the standalone runner, the folded runner serves both products from
  // one process. Skillfleet's collector validates `source` per adapter and
  // silently drops records whose source does not match, so a Bob-claimed
  // session must be able to emit `source: "bob"` and survive the round trip.
  it("records bob-sourced work distinctly from ooda-sourced work", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bob-skillfleet-"));
    temporaryDirectories.push(directory);
    const journalPath = join(directory, "workflows.jsonl");

    const bob = await emitSkillfleetWorkflowEvent(
      { ...baseInput, source: "bob", sessionId: "run-1" },
      { journalPath },
    );
    const ooda = await emitSkillfleetWorkflowEvent(
      { ...baseInput, source: "ooda", sessionId: "run-1" },
      { journalPath },
    );

    expect(bob.state).toBe("written");
    expect(ooda.state).toBe("written");

    const records = readFileSync(journalPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { source: string; recordId: string });

    expect(records.map((record) => record.source)).toEqual(["bob", "ooda"]);
    // Same session, different product: the collector dedupes on recordId, so
    // the two must not collide.
    expect(records[0]!.recordId).not.toBe(records[1]!.recordId);
  });
});
