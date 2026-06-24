/**
 * Aggregate layer that maps handler factory outputs to PlanningRpc contract
 * names (68 procedures).
 *
 * Imports the seven handler factories (planning, planSession, plan, dispatch,
 * skill, snapshot, checkpoint), instantiates them with a HandlerContext, and
 * wires each factory key to the corresponding contract procedure name expected
 * by PlanningRpc.toLayer().
 *
 * Phase 7B-4D-gamma Task 2.
 */
import { Effect } from "effect";
import type { HandlerContext } from "../handlers/context.js";
import { PlanningRpc } from "@gmacko/bob/contracts";
import { makePlanningRpcHandlers } from "../rpc-handlers/planning.js";
import { makePlanSessionRpcHandlers } from "../rpc-handlers/planSession.js";
import { makePlanRpcHandlers } from "../rpc-handlers/plan.js";
import { makeDispatchRpcHandlers } from "../rpc-handlers/dispatch.js";
import { makeSkillRpcHandlers } from "../rpc-handlers/skill.js";
import { makeSnapshotRpcHandlers } from "../rpc-handlers/snapshot.js";
import { makeCheckpointRpcHandlers } from "../rpc-handlers/checkpoint.js";

export const makePlanningLayer = (ctx: HandlerContext) => {
  const pl = makePlanningRpcHandlers(ctx);
  const ps = makePlanSessionRpcHandlers(ctx);
  const pn = makePlanRpcHandlers(ctx);
  const di = makeDispatchRpcHandlers(ctx);
  const sk = makeSkillRpcHandlers(ctx);
  const sn = makeSnapshotRpcHandlers(ctx);
  const cp = makeCheckpointRpcHandlers(ctx);

  return PlanningRpc.toLayer({
    // --- Core planning (21) ---
    "planning.listWorkspaces": pl["planning.listWorkspaces"],
    "planning.listProjects": pl["planning.listProjects"],
    "planning.getProject": pl["planning.getProject"],
    "planning.listTasks": pl["planning.listTasks"],
    "planning.getTask": pl["planning.getTask"],
    "planning.getTaskByIdentifier": pl["planning.getTaskByIdentifier"],
    "planning.createTask": pl["planning.createTask"],
    "planning.updateTask": pl["planning.updateTask"],
    "planning.addComment": pl["planning.addComment"],
    "planning.listComments": pl["planning.listComments"],
    "planning.searchTasks": pl["planning.searchTasks"],
    "planning.listLabels": pl["planning.listLabels"],
    "planning.listCycles": pl["planning.listCycles"],
    "planning.syncLinearProjects": pl["planning.syncLinearProjects"],
    // getCurrentUser requires session.user context not present in
    // HandlerContext — stub returns a minimal record from ctx.userId until
    // the auth layer lands in 7B-5.
    "planning.getCurrentUser": () =>
      Effect.succeed({
        id: ctx.userId,
        email: "",
        name: ctx.userId,
      }),
    "planning.agentClaimTask": pl["planning.agentClaimTask"],
    "planning.agentReportProgress": pl["planning.agentReportProgress"],
    "planning.agentCompleteTask": pl["planning.agentCompleteTask"],
    "planning.agentFailTask": pl["planning.agentFailTask"],
    "planning.agentGetAvailableTasks": pl["planning.agentGetAvailableTasks"],
    "planning.agentStartSession": pl["planning.agentStartSession"],
    "planning.agentEndSession": pl["planning.agentEndSession"],

    // --- Session (15) ---
    "planning.session.create": ps["planSession.create"],
    "planning.session.start": ps["planSession.start"],
    "planning.session.get": ps["planSession.get"],
    "planning.session.list": ps["planSession.list"],
    "planning.session.listByWorkItem": ps["planSession.listByWorkItem"],
    "planning.session.getActiveForWorkItem":
      ps["planSession.getActiveForWorkItem"],
    "planning.session.saveArtifact": ps["planSession.saveArtifact"],
    "planning.session.getPriorContext": ps["planSession.getPriorContext"],
    "planning.session.createDraft": ps["planSession.createDraft"],
    "planning.session.updateDraft": ps["planSession.updateDraft"],
    "planning.session.removeDraft": ps["planSession.removeDraft"],
    "planning.session.setDependency": ps["planSession.setDependency"],
    "planning.session.removeDependency": ps["planSession.removeDependency"],
    "planning.session.commitPlan": ps["planSession.commitPlan"],
    "planning.session.commitPlanLocal": ps["planSession.commitPlanLocal"],

    // --- Task (worktree plans) (11) ---
    "planning.task.list": pn["plan.list"],
    "planning.task.byId": pn["plan.byId"],
    "planning.task.byWorktree": pn["plan.byWorktree"],
    "planning.task.create": pn["plan.create"],
    "planning.task.update": pn["plan.update"],
    "planning.task.delete": pn["plan.delete"],
    "planning.task.syncFromFile": pn["plan.syncFromFile"],
    "planning.task.addTask": pn["plan.addTask"],
    "planning.task.updateTask": pn["plan.updateTask"],
    "planning.task.deleteTask": pn["plan.deleteTask"],
    "planning.task.reorderTasks": pn["plan.reorderTasks"],

    // --- Dispatch (8) ---
    "planning.dispatch.createBatch": di["dispatch.createBatch"],
    "planning.dispatch.getBatch": di["dispatch.getBatch"],
    "planning.dispatch.updateItemAgent": di["dispatch.updateItemAgent"],
    "planning.dispatch.updateConcurrency": di["dispatch.updateConcurrency"],
    "planning.dispatch.dispatch": di["dispatch.dispatch"],
    "planning.dispatch.checkProgress": di["dispatch.checkProgress"],
    "planning.dispatch.listBatches": di["dispatch.listBatches"],
    "planning.dispatch.resetPipelineState": di["dispatch.resetPipelineState"],

    // --- Skill (6) ---
    "planning.skill.list": sk["skill.list"],
    "planning.skill.seed": sk["skill.seed"],
    "planning.skill.getExecution": sk["skill.getExecution"],
    "planning.skill.listExecutions": sk["skill.listExecutions"],
    "planning.skill.recordExecution": sk["skill.recordExecution"],
    "planning.skill.updateExecution": sk["skill.updateExecution"],

    // --- Snapshot (3) ---
    "planning.snapshot.create": sn["planning.snapshot.create"],
    "planning.snapshot.list": sn["planning.snapshot.list"],
    "planning.snapshot.get": sn["planning.snapshot.get"],

    // --- Checkpoint (3) ---
    "planning.checkpoint.create": cp["checkpoint.create"],
    "planning.checkpoint.list": cp["checkpoint.list"],
    "planning.checkpoint.branchFrom": cp["checkpoint.branchFrom"],
  });
};
