import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { PlanningRpc, PlanningDispatchListBatchesRpc, PlanningDispatchGetBatchRpc } from "../groups/planning.js";

describe("PlanningRpc — 7B-4C Task 6 (planning.task.* + planning.dispatch.*)", () => {
  it("has at least 55 procedures after Task 6", () => {
    expect(PlanningRpc.requests.size).toBeGreaterThanOrEqual(55);
  });

  const taskProcedures = [
    "planning.task.list",
    "planning.task.byId",
    "planning.task.byWorktree",
    "planning.task.create",
    "planning.task.update",
    "planning.task.delete",
    "planning.task.syncFromFile",
    "planning.task.addTask",
    "planning.task.updateTask",
    "planning.task.deleteTask",
    "planning.task.reorderTasks",
  ];

  const dispatchProcedures = [
    "planning.dispatch.createBatch",
    "planning.dispatch.getBatch",
    "planning.dispatch.updateItemAgent",
    "planning.dispatch.updateConcurrency",
    "planning.dispatch.dispatch",
    "planning.dispatch.checkProgress",
    "planning.dispatch.listBatches",
    "planning.dispatch.resetPipelineState",
  ];

  it("contains all 11 planning.task.* procedures", () => {
    const names = [...PlanningRpc.requests.keys()];
    for (const proc of taskProcedures) {
      expect(names).toContain(proc);
    }
  });

  it("contains all 8 planning.dispatch.* procedures", () => {
    const names = [...PlanningRpc.requests.keys()];
    for (const proc of dispatchProcedures) {
      expect(names).toContain(proc);
    }
  });

  it("still contains the 36 Task 4+5 procedures", () => {
    const names = [...PlanningRpc.requests.keys()];
    // Spot-check core procedures (Task 4)
    expect(names).toContain("planning.listWorkspaces");
    expect(names).toContain("planning.listTasks");
    expect(names).toContain("planning.agentClaimTask");
    // Spot-check session procedures (Task 5)
    expect(names).toContain("planning.session.create");
    expect(names).toContain("planning.session.commitPlan");
    expect(names).toContain("planning.session.commitPlanLocal");
  });
});

it("preserves review work-item filters over both dispatch operations", () => {
  const list = { workItemId: "item-1", limit: 1 };
  const get = { workItemId: "item-1", batchId: "batch-1" };
  expect(Schema.decodeUnknownSync(PlanningDispatchListBatchesRpc.payloadSchema)(list)).toEqual(list);
  expect(Schema.decodeUnknownSync(PlanningDispatchGetBatchRpc.payloadSchema)(get)).toEqual(get);
});
