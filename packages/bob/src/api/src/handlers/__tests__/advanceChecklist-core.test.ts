import { describe, it, expect } from "vitest";

import {
  decideChecklistAction,
  agentFinishedFromWorkflow,
  gateSpecSchema,
  type ChecklistItemState,
} from "../advanceChecklist-core";

// Shorthand builder; sortOrder defaults to declaration order via index below.
const mk = (
  id: string,
  status: ChecklistItemState["status"],
  extra: Partial<ChecklistItemState> = {},
): ChecklistItemState => ({ id, sortOrder: 0, status, ...extra });

describe("decideChecklistAction", () => {
  it("completes when there are no items", () => {
    expect(decideChecklistAction([])).toEqual({ type: "complete" });
  });

  it("completes when every item is terminal (completed/cancelled)", () => {
    const items = [
      mk("a", "completed", { sortOrder: 0 }),
      mk("b", "cancelled", { sortOrder: 1 }),
    ];
    expect(decideChecklistAction(items)).toEqual({ type: "complete" });
  });

  it("dispatches the first pending item", () => {
    const items = [
      mk("a", "pending", { sortOrder: 0 }),
      mk("b", "pending", { sortOrder: 1 }),
    ];
    expect(decideChecklistAction(items)).toEqual({ type: "dispatch", itemId: "a" });
  });

  it("walks strictly in sortOrder regardless of array order", () => {
    const items = [
      mk("b", "pending", { sortOrder: 2 }),
      mk("a", "completed", { sortOrder: 1 }),
      mk("c", "pending", { sortOrder: 3 }),
    ];
    // a is done; b (sortOrder 2) is next, not c.
    expect(decideChecklistAction(items)).toEqual({ type: "dispatch", itemId: "b" });
  });

  it("never acts on a later item while an earlier one is unfinished", () => {
    const items = [
      mk("a", "in_progress", { sortOrder: 0, agentFinished: false }),
      mk("b", "pending", { sortOrder: 1 }),
    ];
    // a's agent is still working → wait; b must not be dispatched.
    expect(decideChecklistAction(items)).toEqual({ type: "wait" });
  });

  it("runs the gate once the agent finishes and no gate has run yet", () => {
    const items = [mk("a", "in_progress", { agentFinished: true, gateOutcome: null })];
    expect(decideChecklistAction(items)).toEqual({ type: "run_gate", itemId: "a" });
  });

  it("advances when the gate passes", () => {
    const items = [mk("a", "in_progress", { agentFinished: true, gateOutcome: "pass" })];
    expect(decideChecklistAction(items)).toEqual({ type: "advance", itemId: "a" });
  });

  it("repairs (reprompts the same item) when the gate fails under the cap", () => {
    const items = [
      mk("a", "in_progress", { agentFinished: true, gateOutcome: "fail", gateAttempts: 1 }),
    ];
    expect(decideChecklistAction(items, { maxAttempts: 3 })).toEqual({
      type: "repair",
      itemId: "a",
    });
  });

  it("blocks the item once failed-gate attempts hit the cap", () => {
    const items = [
      mk("a", "in_progress", { agentFinished: true, gateOutcome: "fail", gateAttempts: 3 }),
    ];
    const action = decideChecklistAction(items, { maxAttempts: 3 });
    expect(action.type).toBe("block");
    if (action.type === "block") expect(action.itemId).toBe("a");
  });

  it("resumes the next pending item after the current one advances/completes", () => {
    const items = [
      mk("a", "completed", { sortOrder: 0 }),
      mk("b", "pending", { sortOrder: 1 }),
      mk("c", "pending", { sortOrder: 2 }),
    ];
    expect(decideChecklistAction(items)).toEqual({ type: "dispatch", itemId: "b" });
  });
});

describe("agentFinishedFromWorkflow", () => {
  it("treats completed and awaiting_review as finished (ready to gate)", () => {
    expect(agentFinishedFromWorkflow("completed")).toBe(true);
    expect(agentFinishedFromWorkflow("awaiting_review")).toBe(true);
  });
  it("treats working / pre-start / human-gated / null as not finished", () => {
    for (const s of ["started", "working", "awaiting_input", "blocked", null, undefined, ""]) {
      expect(agentFinishedFromWorkflow(s as string | null)).toBe(false);
    }
  });
});

describe("gateSpecSchema", () => {
  it("accepts a deterministic test gate with a command", () => {
    expect(gateSpecSchema.parse({ kind: "test", command: "pnpm test" })).toEqual({
      kind: "test",
      command: "pnpm test",
    });
  });

  it("accepts ci / reviewer / human gates", () => {
    expect(() => gateSpecSchema.parse({ kind: "ci" })).not.toThrow();
    expect(() => gateSpecSchema.parse({ kind: "reviewer", criteria: "tests cover edge cases" })).not.toThrow();
    expect(() => gateSpecSchema.parse({ kind: "human" })).not.toThrow();
  });

  it("rejects a test gate with no command (un-runnable)", () => {
    expect(() => gateSpecSchema.parse({ kind: "test" })).toThrow();
    expect(() => gateSpecSchema.parse({ kind: "test", command: "" })).toThrow();
  });

  it("rejects an unknown gate kind", () => {
    expect(() => gateSpecSchema.parse({ kind: "vibes" })).toThrow();
  });
});
