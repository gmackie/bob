import { describe, expect, it } from "vitest";
import { ITEM_STATES, MILESTONES, RELEASE_STAGES } from "../src/generated/contract";
import { itemAttention, MILESTONE_LABEL, STALL_AFTER_MS, stateAge, RELEASE_STAGE_PRESENTATION, STATE_EDGES, STATE_PRESENTATION } from "../src/presentation";

describe("presentation spec", () => {
  it("covers every coordinator item state exactly", () => {
    expect(Object.keys(STATE_PRESENTATION).sort()).toEqual([...ITEM_STATES].sort());
  });
  it("labels every milestone", () => {
    expect(Object.keys(MILESTONE_LABEL).sort()).toEqual([...MILESTONES].sort());
  });
  it("gives every state its own grid cell", () => {
    const cells = Object.values(STATE_PRESENTATION).map((s) => `${s.col}:${s.row}`);
    expect(new Set(cells).size).toBe(cells.length);
  });
  it("labels every release stage", () => {
    expect(Object.keys(RELEASE_STAGE_PRESENTATION).sort()).toEqual([...RELEASE_STAGES].sort());
  });
  it("treats validating as moving now that the release driver runs it", () => {
    expect(STATE_PRESENTATION.validating.attention).toBe("ok");
  });
  it("refines attention by the release", () => {
    const r = (stage: (typeof RELEASE_STAGES)[number], autoMerge = false) => ({ stage, autoMerge });
    expect(itemAttention({ state: "validating" })).toBe("ok");
    expect(itemAttention({ state: "validating", release: r("blocked") })).toBe("needs_human");
    expect(itemAttention({ state: "deploying", release: r("blocked") })).toBe("needs_human");
    expect(itemAttention({ state: "failed", release: r("checks-failed") })).toBe("failed");
    expect(itemAttention({ state: "review", release: r("review-ready") })).toBe("needs_human");
    expect(itemAttention({ state: "review", release: r("review-ready", true) })).toBe("ok");
    expect(itemAttention({ state: "deploying", release: r("deploying") })).toBe("ok");
  });
  it("treats cancelling as system-owned, not terminal", () => {
    expect(STATE_PRESENTATION.cancelling.owner).toBe("system");
  });
  it("draws edges only between known states", () => {
    for (const edge of STATE_EDGES) {
      expect(ITEM_STATES).toContain(edge.from);
      expect(ITEM_STATES).toContain(edge.to);
    }
  });
  // The transitions packages/bob/coordination/runtime/{coordinator,execution}.mjs
  // actually perform today, plus the release driver (BOB-82). Contract states
  // nothing writes yet (waiting-input, cancelling) get a cell but no edges, so the
  // graph never promises a path the coordinator can't take.
  it("draws exactly the transitions the coordinator performs, once each", () => {
    const drawn = STATE_EDGES.map((e) => `${e.from}->${e.to}`);
    expect(new Set(drawn).size).toBe(drawn.length);
    expect([...drawn].sort()).toEqual(
      [
        "pending->ready",
        "ready->pending",
        "pending->cancelled",
        "ready->cancelled",
        "ready->reserved",
        "reserved->running",
        "reserved->execution-unknown",
        "execution-unknown->running",
        "running->validating",
        "running->completed",
        "running->failed",
        "running->cancelled",
        "validating->review",
        "review->deploying",
        "review->completed",
        "deploying->completed",
        "validating->failed",
        "review->validating",
        "failed->reserved",
        "cancelled->reserved",
      ].sort(),
    );
  });
});

describe("stall (BOB-101)", () => {
  const H = 3_600_000;
  it("marks an in-flight item stalled once it outstays its state's limit", () => {
    const since = 1_000_000;
    expect(itemAttention({ state: "validating", stateSince: since }, since + 6 * H)).toBe("ok");
    expect(itemAttention({ state: "validating", stateSince: since }, since + 6 * H + 1)).toBe("stalled");
    expect(itemAttention({ state: "running", stateSince: since }, since + 25 * H)).toBe("stalled");
  });
  it("never stalls without a clock, without a stamp, or in states the system does not own", () => {
    expect(itemAttention({ state: "validating", stateSince: 0 })).toBe("ok");
    expect(itemAttention({ state: "validating", stateSince: null }, 10 ** 12)).toBe("ok");
    for (const state of ["pending", "ready", "completed", "cancelled"] as const) {
      expect(STALL_AFTER_MS[state]).toBeUndefined();
      expect(itemAttention({ state, stateSince: 0 }, 10 ** 12)).toBe("ok");
    }
  });
  it("keeps stronger attention over a stall", () => {
    expect(itemAttention({ state: "validating", stateSince: 0, release: { stage: "checks-failed", autoMerge: false } }, 10 ** 12)).toBe("failed");
    expect(itemAttention({ state: "review", stateSince: 0 }, 10 ** 12)).toBe("needs_human");
  });
  it("ages from the edge stamp", () => {
    expect(stateAge({ stateSince: 100 }, 250)).toBe(150);
    expect(stateAge({ stateSince: 300 }, 250)).toBe(0);
    expect(stateAge({}, 250)).toBeNull();
  });
});
