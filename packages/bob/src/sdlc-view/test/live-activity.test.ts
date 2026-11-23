import { describe, expect, it } from "vitest";
import { isActivityToken, ITEM_STATES, LIVE_ACTIVITY_STAGES, liveActivityContent, type ItemSnapshot, type PlanSnapshot } from "../src";

const target = { environmentId: "e", projectId: "bob", repository: { integrationId: "forgegraph", repositoryId: "bob" } };
const plan: PlanSnapshot = {
  planId: "p1", resourceVersion: 1, state: "active",
  definition: { items: [{ itemId: "i1", issue: { integrationId: "k", workspaceId: "w", teamId: "t", projectId: "p", issueId: "x", identifier: "BOB-96" }, target, completionTarget: "production-verified" }], dependencies: [], concurrencyLimit: 1 },
};
const item = (state: ItemSnapshot["state"], extra: Partial<ItemSnapshot> = {}): ItemSnapshot =>
  ({ itemId: "i1", planId: "p1", resourceVersion: 1, state, achievedMilestones: [], operationIds: [], evidenceRefs: [], ...extra });

describe("liveActivityContent (BOB-96)", () => {
  it("maps every state to a stage in range", () => {
    for (const state of ITEM_STATES) {
      const c = liveActivityContent(item(state), plan);
      expect(c.stage).toBeGreaterThanOrEqual(0);
      expect(c.stage).toBeLessThan(LIVE_ACTIVITY_STAGES.length);
    }
  });
  it("walks the stages and flags what needs you", () => {
    expect(liveActivityContent(item("running"), plan)).toEqual({ issue: "BOB-96", repository: "bob", state: "running", label: "Running", stage: 1, needsYou: false, failed: false, ended: false });
    expect(liveActivityContent(item("waiting-input"), plan)).toMatchObject({ stage: 1, needsYou: true });
    expect(liveActivityContent(item("review", { release: { attemptId: "a", stage: "review-ready", autoMerge: true, updatedAt: "t" } }), plan)).toMatchObject({ stage: 3, needsYou: false });
    expect(liveActivityContent(item("completed"), plan)).toMatchObject({ stage: 5, ended: true, failed: false });
    expect(liveActivityContent(item("failed"), plan)).toMatchObject({ ended: true, failed: true });
  });
  it("never carries agent text", () => {
    const pendingInput = { attemptId: "a", promptId: "r", kind: "user_input" as const, createdAt: "t", questions: [{ id: "q", question: "SECRET QUESTION", options: [], multiSelect: false }] };
    expect(JSON.stringify(liveActivityContent(item("waiting-input", { pendingInput }), plan))).not.toContain("SECRET");
  });
  it("works without the plan", () => {
    expect(liveActivityContent(item("deploying"), undefined)).toMatchObject({ issue: null, repository: null, stage: 4 });
  });
});

describe("isActivityToken", () => {
  it("accepts hex tokens only", () => {
    expect(isActivityToken("ab".repeat(32))).toBe(true);
    for (const bad of ["", "zz".repeat(32), "ab", "ab".repeat(200), 3, null]) expect(isActivityToken(bad)).toBe(false);
  });
});
