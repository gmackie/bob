import { describe, expect, it } from "vitest";

import {
  buildBootstrapPlan,
  confirmationFor,
  validateApplyGuard,
  type BootstrapSnapshot,
  type MigrationDescriptor,
} from "../production-bootstrap";

const migrations: MigrationDescriptor[] = Array.from(
  { length: 20 },
  (_, idx) => ({
    idx,
    tag: `${String(idx).padStart(4, "0")}_migration`,
    hash: `hash-${idx}`,
    when: 1_000 + idx,
    statements: [`select ${idx}`],
  }),
);

const baselineLandmarks = {
  research_thread: true,
  runner_session: true,
  session_event: true,
  personal_vault_sources: true,
  research_vault_sources: true,
  graph_exploration: true,
  thread_memory_embedding_model: true,
  graph_exploration_thread_id_idx: true,
};

function snapshot(
  overrides: Partial<BootstrapSnapshot> = {},
): BootstrapSnapshot {
  return {
    database: "bob",
    currentUser: "postgres",
    serverVersion: "17.9",
    vectorVersion: "0.8.2",
    oodaSchemaExists: false,
    ledgerExists: false,
    ledger: [],
    baselineLandmarks,
    appRole: "bob",
    appRoleExists: true,
    ...overrides,
  };
}

describe("production OODA bootstrap planning", () => {
  it("adopts an intact unmanaged research baseline and applies only 0006+", () => {
    const plan = buildBootstrapPlan(snapshot(), migrations);

    expect(plan.mode).toBe("fresh");
    expect(plan.baselineAdoptions.map((migration) => migration.idx)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(plan.pending.map((migration) => migration.idx)).toEqual([
      6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(plan.problems).toEqual([]);
  });

  it("refuses baseline adoption when any legacy landmark is absent", () => {
    const plan = buildBootstrapPlan(
      snapshot({
        baselineLandmarks: {
          ...baselineLandmarks,
          thread_memory_embedding_model: false,
        },
      }),
      migrations,
    );

    expect(plan.mode).toBe("blocked");
    expect(plan.problems).toContain(
      "Legacy baseline landmark is missing: thread_memory_embedding_model",
    );
  });

  it("refuses an OODA schema without the OODA migration ledger", () => {
    const plan = buildBootstrapPlan(
      snapshot({ oodaSchemaExists: true }),
      migrations,
    );

    expect(plan.mode).toBe("blocked");
    expect(plan.problems).toContain(
      "The ooda schema exists without an OODA migration ledger",
    );
  });

  it("resumes from a contiguous hash-verified ledger", () => {
    const ledger = migrations.slice(0, 10).map((migration) => ({
      idx: migration.idx,
      tag: migration.tag,
      hash: migration.hash,
      baselineAdopted: migration.idx < 6,
    }));
    const plan = buildBootstrapPlan(
      snapshot({ oodaSchemaExists: true, ledgerExists: true, ledger }),
      migrations,
    );

    expect(plan.mode).toBe("resume");
    expect(plan.pending[0]?.idx).toBe(10);
    expect(plan.pending.at(-1)?.idx).toBe(19);
  });

  it("refuses ledger gaps and migration hash drift", () => {
    const ledger = migrations.slice(0, 8).map((migration) => ({
      idx: migration.idx,
      tag: migration.tag,
      hash: migration.hash,
      baselineAdopted: migration.idx < 6,
    }));
    ledger[6] = { ...ledger[6]!, hash: "changed" };
    ledger.splice(4, 1);

    const plan = buildBootstrapPlan(
      snapshot({ oodaSchemaExists: true, ledgerExists: true, ledger }),
      migrations,
    );

    expect(plan.mode).toBe("blocked");
    expect(plan.problems.some((problem) => problem.includes("gap"))).toBe(true);
    expect(
      plan.problems.some((problem) => problem.includes("hash drift")),
    ).toBe(true);
  });

  it("requires a database-specific confirmation and backup checksum", () => {
    const plan = buildBootstrapPlan(snapshot(), migrations);
    const expected = confirmationFor(snapshot(), plan);

    expect(() =>
      validateApplyGuard(snapshot(), plan, {
        confirmation: expected,
        backupSha256: "a".repeat(64),
      }),
    ).not.toThrow();
    expect(() =>
      validateApplyGuard(snapshot(), plan, {
        confirmation: "APPLY-OODA-PERSONAL-OS:other:0019_migration",
        backupSha256: "a".repeat(64),
      }),
    ).toThrow(/confirmation/i);
    expect(() =>
      validateApplyGuard(snapshot(), plan, {
        confirmation: expected,
        backupSha256: "not-a-checksum",
      }),
    ).toThrow(/backup/i);
  });
});
