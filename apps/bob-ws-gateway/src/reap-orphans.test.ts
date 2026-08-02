import { describe, it, expect } from "vitest";

import {
  REAP_ORPHAN_RUNNING_GRACE_MS,
  REAP_ORPHAN_QUEUED_GRACE_MS,
  isReapableOrphan,
  orphanReapGraceMs,
  orphanReapCutoffs,
} from "./reap-orphans.js";

const NOW = new Date("2026-08-02T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("orphan reap graces", () => {
  it("queued gets a much longer grace than running", () => {
    expect(REAP_ORPHAN_QUEUED_GRACE_MS).toBeGreaterThan(REAP_ORPHAN_RUNNING_GRACE_MS);
    expect(orphanReapGraceMs("running")).toBe(REAP_ORPHAN_RUNNING_GRACE_MS);
    expect(orphanReapGraceMs("queued")).toBe(REAP_ORPHAN_QUEUED_GRACE_MS);
  });

  it("only queued/running are reapable statuses", () => {
    for (const s of ["completed", "failed", "blocked", "host_unknown", "interrupted", "done"]) {
      expect(orphanReapGraceMs(s)).toBeNull();
    }
  });
});

describe("isReapableOrphan", () => {
  it("reaps a running run with no session past 1h", () => {
    expect(
      isReapableOrphan({ status: "running", sessionId: null, createdAt: ago(90 * MIN) }, NOW),
    ).toBe(true);
  });

  it("does NOT reap a running run within its grace", () => {
    expect(
      isReapableOrphan({ status: "running", sessionId: null, createdAt: ago(30 * MIN) }, NOW),
    ).toBe(false);
  });

  it("never reaps a run that still holds a session (lease sweep's job)", () => {
    expect(
      isReapableOrphan({ status: "running", sessionId: "sess-1", createdAt: ago(10 * HOUR) }, NOW),
    ).toBe(false);
  });

  // The fix: a queued run waiting well past the OLD 60-min grace is no longer
  // false-failed — it may be legitimately concurrency-capped.
  it("does NOT reap a queued run at 90 min (previously false-failed)", () => {
    expect(
      isReapableOrphan({ status: "queued", sessionId: null, createdAt: ago(90 * MIN) }, NOW),
    ).toBe(false);
  });

  it("does NOT reap a queued run at 6h (still within the longer grace)", () => {
    expect(
      isReapableOrphan({ status: "queued", sessionId: null, createdAt: ago(6 * HOUR) }, NOW),
    ).toBe(false);
  });

  it("still reaps a truly abandoned queued run past 12h", () => {
    expect(
      isReapableOrphan({ status: "queued", sessionId: null, createdAt: ago(13 * HOUR) }, NOW),
    ).toBe(true);
  });

  it("never reaps a terminal run", () => {
    expect(
      isReapableOrphan({ status: "completed", sessionId: null, createdAt: ago(10 * HOUR) }, NOW),
    ).toBe(false);
  });

  it("is robust to an unparseable createdAt", () => {
    expect(
      isReapableOrphan({ status: "running", sessionId: null, createdAt: "not-a-date" }, NOW),
    ).toBe(false);
  });
});

describe("orphanReapCutoffs", () => {
  it("returns per-status cutoffs the bulk query compares against", () => {
    const { runningCutoff, queuedCutoff } = orphanReapCutoffs(NOW);
    expect(runningCutoff).toBe(new Date(NOW.getTime() - REAP_ORPHAN_RUNNING_GRACE_MS).toISOString());
    expect(queuedCutoff).toBe(new Date(NOW.getTime() - REAP_ORPHAN_QUEUED_GRACE_MS).toISOString());
    // queued cutoff is further in the past → fewer queued rows qualify.
    expect(new Date(queuedCutoff).getTime()).toBeLessThan(new Date(runningCutoff).getTime());
  });
});
