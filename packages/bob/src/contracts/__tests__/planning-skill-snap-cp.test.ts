import { describe, expect, it } from "vitest";
import { PlanningRpc } from "../groups/planning.js";

describe("PlanningRpc — 7B-4C Task 7 (planning.skill.* + snapshot.* + checkpoint.*)", () => {
  it("has 68 procedures after adding Linear sync coverage", () => {
    expect(PlanningRpc.requests.size).toBe(68);
  });

  const skillProcedures = [
    "planning.skill.list",
    "planning.skill.seed",
    "planning.skill.getExecution",
    "planning.skill.listExecutions",
    "planning.skill.recordExecution",
    "planning.skill.updateExecution",
  ];

  const snapshotProcedures = [
    "planning.snapshot.create",
    "planning.snapshot.list",
    "planning.snapshot.get",
  ];

  const checkpointProcedures = [
    "planning.checkpoint.create",
    "planning.checkpoint.list",
    "planning.checkpoint.branchFrom",
  ];

  it("contains all 6 planning.skill.* procedures", () => {
    const names = [...PlanningRpc.requests.keys()];
    for (const proc of skillProcedures) {
      expect(names).toContain(proc);
    }
  });

  it("contains all 3 planning.snapshot.* procedures", () => {
    const names = [...PlanningRpc.requests.keys()];
    for (const proc of snapshotProcedures) {
      expect(names).toContain(proc);
    }
  });

  it("contains all 3 planning.checkpoint.* procedures", () => {
    const names = [...PlanningRpc.requests.keys()];
    for (const proc of checkpointProcedures) {
      expect(names).toContain(proc);
    }
  });

  it("contains the Linear project sync procedure", () => {
    const names = [...PlanningRpc.requests.keys()];
    expect(names).toContain("planning.syncLinearProjects");
  });

  it("still contains the 55 Task 4+5+6 procedures", () => {
    const names = [...PlanningRpc.requests.keys()];
    // Spot-check core procedures (Task 4)
    expect(names).toContain("planning.listWorkspaces");
    expect(names).toContain("planning.listTasks");
    expect(names).toContain("planning.agentClaimTask");
    // Spot-check session procedures (Task 5)
    expect(names).toContain("planning.session.create");
    expect(names).toContain("planning.session.commitPlan");
    // Spot-check task procedures (Task 6)
    expect(names).toContain("planning.task.list");
    expect(names).toContain("planning.dispatch.createBatch");
  });
});
