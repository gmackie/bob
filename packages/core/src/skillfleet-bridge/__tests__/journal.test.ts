import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { emitSkillfleetWorkflowEvent } from "../journal";

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

describe("per-source journal routing", () => {
  const base = {
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

  // Skillfleet's collector builds one adapter per source and throws
  // "workflow journal source mismatch" on any record whose source does not
  // match the file it came from. Routing both sources to one path makes the
  // collector silently discard the mismatched half — so this is a data-loss
  // guard, not a tidiness preference.
  it("sends bob and ooda records to independent journals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skillfleet-routing-"));
    temporaryDirectories.push(directory);
    const bobJournal = join(directory, "bob.jsonl");
    const oodaJournal = join(directory, "ooda.jsonl");
    const environment = {
      SKILLFLEET_BOB_WORKFLOW_JOURNAL: bobJournal,
      SKILLFLEET_OODA_WORKFLOW_JOURNAL: oodaJournal,
    };

    await emitSkillfleetWorkflowEvent({ ...base, source: "bob" }, { environment });
    await emitSkillfleetWorkflowEvent({ ...base, source: "ooda" }, { environment });

    expect(JSON.parse(readFileSync(bobJournal, "utf8").trim()).source).toBe("bob");
    expect(JSON.parse(readFileSync(oodaJournal, "utf8").trim()).source).toBe("ooda");
  });

  // The regression this replaces: with only the OODA var set, bob-sourced
  // records used to land in the OODA journal, where the collector drops them.
  it("does not put bob records in the ooda journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skillfleet-routing-"));
    temporaryDirectories.push(directory);
    const oodaJournal = join(directory, "ooda.jsonl");

    const result = await emitSkillfleetWorkflowEvent(
      { ...base, source: "bob" },
      { environment: { SKILLFLEET_OODA_WORKFLOW_JOURNAL: oodaJournal } },
    );

    expect(result).toEqual({ state: "disabled" });
    expect(existsSync(oodaJournal)).toBe(false);
  });

  it("falls back to the shared journal when no per-source var is set", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skillfleet-routing-"));
    temporaryDirectories.push(directory);
    const shared = join(directory, "shared.jsonl");
    const environment = { SKILLFLEET_WORKFLOW_JOURNAL: shared };

    await emitSkillfleetWorkflowEvent({ ...base, source: "bob" }, { environment });
    await emitSkillfleetWorkflowEvent({ ...base, source: "ooda" }, { environment });

    const sources = readFileSync(shared, "utf8")
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { source: string }).source);
    expect(sources).toEqual(["bob", "ooda"]);
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
