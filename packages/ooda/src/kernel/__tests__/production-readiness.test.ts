import { describe, expect, it } from "vitest";

import { evaluateProductionReadiness } from "../production-readiness";

const healthy = {
  generatedAt: new Date("2026-08-23T12:00:00.000Z"),
  dogfoodStartedAt: new Date("2026-08-09T12:00:00.000Z"),
  acceptedTurnCount: 100,
  unresolvedTurnCount: 0,
  duplicateDestinationCount: 0,
  unauthorizedSensitiveDisclosureCount: 0,
  externalWriteCount: 3,
  externalWriteLineageGapCount: 0,
  unrepairedDeadLetterCount: 0,
  offlineReconciliationConfirmed: true,
  endToEndExecutionConfirmed: true,
  mobileDailyDriverConfirmed: true,
  legacyRetirementConfirmed: true,
};

describe("production readiness", () => {
  it("passes only when all automatic and witnessed dogfood gates are satisfied", () => {
    const snapshot = evaluateProductionReadiness(healthy);

    expect(snapshot.ready).toBe(true);
    expect(snapshot.dogfoodElapsedDays).toBe(14);
    expect(snapshot.gates.every((gate) => gate.status === "pass")).toBe(true);
  });

  it("fails invariant violations and leaves unobserved proof pending", () => {
    const snapshot = evaluateProductionReadiness({
      ...healthy,
      dogfoodStartedAt: undefined,
      acceptedTurnCount: 0,
      unresolvedTurnCount: 2,
      duplicateDestinationCount: 1,
      unauthorizedSensitiveDisclosureCount: 1,
      externalWriteCount: 1,
      externalWriteLineageGapCount: 1,
      unrepairedDeadLetterCount: 1,
      offlineReconciliationConfirmed: false,
      endToEndExecutionConfirmed: false,
      mobileDailyDriverConfirmed: false,
      legacyRetirementConfirmed: false,
    });

    expect(snapshot.ready).toBe(false);
    expect(
      snapshot.gates.find((gate) => gate.id === "dogfood_duration")?.status,
    ).toBe("pending");
    expect(
      snapshot.gates.find((gate) => gate.id === "accepted_turn_durability")
        ?.status,
    ).toBe("fail");
    expect(
      snapshot.gates.find((gate) => gate.id === "duplicate_destinations")
        ?.status,
    ).toBe("fail");
    expect(
      snapshot.gates.find((gate) => gate.id === "mobile_daily_driver")?.status,
    ).toBe("pending");
  });

  it("keeps an uneventful dogfood period pending instead of declaring success", () => {
    const snapshot = evaluateProductionReadiness({
      ...healthy,
      acceptedTurnCount: 0,
      externalWriteCount: 0,
    });

    expect(
      snapshot.gates.find((gate) => gate.id === "accepted_turn_durability")
        ?.status,
    ).toBe("pending");
    expect(
      snapshot.gates.find((gate) => gate.id === "external_write_lineage")
        ?.status,
    ).toBe("pending");
  });
});
