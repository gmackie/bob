import { describe, expect, it } from "vitest";
import { ITEM_STATES, MILESTONES } from "../src/generated/contract";
import { MILESTONE_LABEL, STATE_EDGES, STATE_PRESENTATION } from "../src/presentation";

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
  it("marks validating as stalled until the coordinator automates it", () => {
    expect(STATE_PRESENTATION.validating.attention).toBe("stalled");
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
  // actually perform today. Contract states nothing writes yet (waiting-input,
  // review, deploying, cancelling) get a cell but no edges, so the graph never
  // promises a path the coordinator can't take.
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
        "failed->reserved",
        "cancelled->reserved",
      ].sort(),
    );
  });
});
