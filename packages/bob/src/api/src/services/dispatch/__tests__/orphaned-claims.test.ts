import { describe, expect, it, vi } from "vitest";

import {
  resolveOrphanReconcileMode,
  resolveOrphanedClaim,
  runOrphanReconcileSweep,
} from "../orphaned-claims";

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

describe("orphan reconcile sweep gate", () => {
  const sweepResult = {
    released: 2,
    items: [
      { id: "item-a", reason: "claimed but never dispatched" },
      { id: "item-b", reason: "every run ended" },
    ],
    dryRun: false,
  };

  it("does nothing by default: no mode set means no sweep and no db work", async () => {
    const sweep = vi.fn(async () => sweepResult);
    const loadSweep = vi.fn(async () => sweep);
    const log = vi.fn();

    const out = await runOrphanReconcileSweep({}, loadSweep, log);

    expect(out).toEqual({ mode: "off" });
    expect(loadSweep).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("treats empty, legacy and unrecognised values as off", async () => {
    for (const raw of [undefined, null, "", "off", "true", "1", "enabled", "yes"]) {
      expect(resolveOrphanReconcileMode(raw)).toBe("off");
      const loadSweep = vi.fn();
      await runOrphanReconcileSweep(
        { BOB_ORPHAN_RECONCILE_MODE: raw },
        loadSweep,
        () => {},
      );
      expect(loadSweep).not.toHaveBeenCalled();
    }
  });

  it("dry-run sweeps without writing and logs the count", async () => {
    const sweep = vi.fn(async () => ({ ...sweepResult, dryRun: true }));
    const log = vi.fn();

    const out = await runOrphanReconcileSweep(
      { BOB_ORPHAN_RECONCILE_MODE: "dry-run", BOB_ORPHAN_RECONCILE_LIMIT: "500" },
      async () => sweep,
      log,
    );

    expect(out.mode).toBe("dry-run");
    expect(sweep).toHaveBeenCalledWith({
      idleMs: undefined,
      limit: 500,
      dryRun: true,
    });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/would release 2 item/));
  });

  it("only writes when explicitly on", async () => {
    const sweep = vi.fn(async () => sweepResult);
    await runOrphanReconcileSweep(
      { BOB_ORPHAN_RECONCILE_MODE: "on", BOB_ORPHAN_RECONCILE_IDLE_MS: "3600000" },
      async () => sweep,
      () => {},
    );
    expect(sweep).toHaveBeenCalledWith({
      idleMs: 3600000,
      limit: undefined,
      dryRun: false,
    });
  });
});
