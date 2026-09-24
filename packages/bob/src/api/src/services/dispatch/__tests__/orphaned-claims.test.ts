import { describe, expect, it } from "vitest";

import { resolveOrphanedClaim } from "../orphaned-claims";

const HOUR = 60 * 60 * 1000;
const base = {
  status: "in_progress",
  hasActiveSession: false,
  hasActiveRun: false,
  hasAnyRun: false,
  idleMs: 48 * HOUR,
  thresholdMs: 6 * HOUR,
};

describe("resolveOrphanedClaim", () => {
  it("releases an item that was claimed but never dispatched", () => {
    // 275 production items were in this exact state: in progress, no run ever.
    const outcome = resolveOrphanedClaim(base);
    expect(outcome.release).toBe(true);
    if (!outcome.release) throw new Error("expected a release");
    expect(outcome.to).toBe("todo");
    expect(outcome.reason).toMatch(/never dispatched/i);
  });

  it("releases an item whose runs all ended without moving it", () => {
    // The other 167: runs existed, all terminal, status never reconciled.
    const outcome = resolveOrphanedClaim({ ...base, hasAnyRun: true });
    expect(outcome.release).toBe(true);
    if (!outcome.release) throw new Error("expected a release");
    expect(outcome.reason).toMatch(/every run ended/i);
  });

  it("leaves live work alone, which the session reaper owns", () => {
    expect(resolveOrphanedClaim({ ...base, hasActiveSession: true })).toEqual({
      release: false,
    });
    expect(resolveOrphanedClaim({ ...base, hasActiveRun: true })).toEqual({
      release: false,
    });
  });

  it("waits out the threshold before calling anything abandoned", () => {
    expect(resolveOrphanedClaim({ ...base, idleMs: 1 * HOUR })).toEqual({
      release: false,
    });
    // Exactly at the threshold counts as abandoned.
    expect(
      resolveOrphanedClaim({ ...base, idleMs: 6 * HOUR }).release,
    ).toBe(true);
  });

  it("only ever touches in_progress", () => {
    for (const status of ["todo", "in_review", "done", "failed", "blocked"]) {
      expect(resolveOrphanedClaim({ ...base, status })).toEqual({
        release: false,
      });
    }
  });
});
