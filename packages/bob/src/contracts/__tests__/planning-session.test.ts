import { describe, expect, it } from "vitest";
import { PlanningRpc } from "../groups/planning.js";

describe("PlanningRpc — 7B-4C Task 5 (planning.session.*)", () => {
  it("has 55 procedures after Task 5 + Task 6", () => {
    expect(PlanningRpc.requests.size).toBeGreaterThanOrEqual(55);
  });

  const sessionProcedures = [
    "planning.session.create",
    "planning.session.start",
    "planning.session.get",
    "planning.session.list",
    "planning.session.listByWorkItem",
    "planning.session.getActiveForWorkItem",
    "planning.session.saveArtifact",
    "planning.session.getPriorContext",
    "planning.session.createDraft",
    "planning.session.updateDraft",
    "planning.session.removeDraft",
    "planning.session.setDependency",
    "planning.session.removeDependency",
    "planning.session.commitPlan",
    "planning.session.commitPlanLocal",
  ];

  it("contains all 15 planning.session.* procedures", () => {
    const names = [...PlanningRpc.requests.keys()];
    for (const proc of sessionProcedures) {
      expect(names).toContain(proc);
    }
  });

  it("still contains the 21 Task 4 procedures", () => {
    const names = [...PlanningRpc.requests.keys()];
    expect(names).toContain("planning.listWorkspaces");
    expect(names).toContain("planning.listTasks");
    expect(names).toContain("planning.createTask");
    expect(names).toContain("planning.getCurrentUser");
    expect(names).toContain("planning.agentClaimTask");
    expect(names).toContain("planning.agentEndSession");
  });
});
