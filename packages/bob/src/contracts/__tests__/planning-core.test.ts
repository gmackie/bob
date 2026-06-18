import { describe, expect, it } from "vitest";
import { PlanningRpc } from "../groups/planning.js";

describe("PlanningRpc — 7B-4C Task 4", () => {
  it("has 55 procedures after Task 4 + Task 5 + Task 6", () => {
    expect(PlanningRpc.requests.size).toBeGreaterThanOrEqual(55);
  });

  it("contains core planning procedures", () => {
    const names = [...PlanningRpc.requests.keys()];
    expect(names).toContain("planning.listWorkspaces");
    expect(names).toContain("planning.listTasks");
    expect(names).toContain("planning.createTask");
    expect(names).toContain("planning.getCurrentUser");
  });

  it("contains agent procedures", () => {
    const names = [...PlanningRpc.requests.keys()];
    expect(names).toContain("planning.agentClaimTask");
    expect(names).toContain("planning.agentCompleteTask");
    expect(names).toContain("planning.agentFailTask");
    expect(names).toContain("planning.agentGetAvailableTasks");
  });
});
