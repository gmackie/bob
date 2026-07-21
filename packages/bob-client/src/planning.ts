import { PlanningRpc } from "@gmacko/bob/contracts";

import type { ClientRuntime } from "./internal/runtime.js";
import { makeInvoke, type RpcMethod } from "./internal/invoke.js";

export interface PlanningClient {
  readonly listWorkspaces: () => Promise<unknown>;
  readonly listProjects: RpcMethod;
  readonly getProject: RpcMethod;
  readonly listTasks: RpcMethod;
  readonly getTask: RpcMethod;
  readonly getTaskByIdentifier: RpcMethod;
  readonly createTask: RpcMethod;
  readonly updateTask: RpcMethod;
  readonly addComment: RpcMethod;
  readonly listComments: RpcMethod;
  readonly searchTasks: RpcMethod;
  readonly listLabels: RpcMethod;
  readonly listCycles: RpcMethod;
  readonly syncLinearProjects: RpcMethod;
  readonly getCurrentUser: () => Promise<unknown>;
  readonly dispatch: {
    readonly createBatch: RpcMethod;
    readonly getBatch: RpcMethod;
    readonly updateItemAgent: RpcMethod;
    readonly updateConcurrency: RpcMethod;
    readonly dispatch: RpcMethod;
    readonly checkProgress: RpcMethod;
    readonly listBatches: RpcMethod;
    readonly resetPipelineState: RpcMethod;
  };
  readonly session: {
    readonly create: RpcMethod;
    readonly start: RpcMethod;
    readonly get: RpcMethod;
    readonly list: RpcMethod;
    readonly listByWorkItem: RpcMethod;
    readonly getActiveForWorkItem: RpcMethod;
    readonly saveArtifact: RpcMethod;
    readonly getPriorContext: RpcMethod;
    readonly createDraft: RpcMethod;
    readonly updateDraft: RpcMethod;
    readonly removeDraft: RpcMethod;
    readonly setDependency: RpcMethod;
    readonly removeDependency: RpcMethod;
    readonly commitPlan: RpcMethod;
    readonly commitPlanLocal: RpcMethod;
  };
  readonly task: {
    readonly list: RpcMethod;
    readonly byId: RpcMethod;
    readonly byWorktree: RpcMethod;
    readonly create: RpcMethod;
    readonly update: RpcMethod;
    readonly delete: RpcMethod;
    readonly syncFromFile: RpcMethod;
    readonly addTask: RpcMethod;
    readonly updateTask: RpcMethod;
    readonly deleteTask: RpcMethod;
    readonly reorderTasks: RpcMethod;
  };
  readonly skill: {
    readonly list: RpcMethod;
    readonly seed: RpcMethod;
    readonly getExecution: RpcMethod;
    readonly listExecutions: RpcMethod;
    readonly recordExecution: RpcMethod;
    readonly updateExecution: RpcMethod;
  };
  readonly snapshot: {
    readonly create: RpcMethod;
    readonly list: RpcMethod;
    readonly get: RpcMethod;
  };
  readonly checkpoint: {
    readonly create: RpcMethod;
    readonly list: RpcMethod;
    readonly branchFrom: RpcMethod;
  };
}

export const makePlanningClient = (runtime: ClientRuntime): PlanningClient => {
  const invoke = makeInvoke(runtime, PlanningRpc);

  return {
    listWorkspaces: () => invoke("planning.listWorkspaces"),
    listProjects: (input) => invoke("planning.listProjects", input),
    getProject: (input) => invoke("planning.getProject", input),
    listTasks: (input) => invoke("planning.listTasks", input),
    getTask: (input) => invoke("planning.getTask", input),
    getTaskByIdentifier: (input) =>
      invoke("planning.getTaskByIdentifier", input),
    createTask: (input) => invoke("planning.createTask", input),
    updateTask: (input) => invoke("planning.updateTask", input),
    addComment: (input) => invoke("planning.addComment", input),
    listComments: (input) => invoke("planning.listComments", input),
    searchTasks: (input) => invoke("planning.searchTasks", input),
    listLabels: (input) => invoke("planning.listLabels", input),
    listCycles: (input) => invoke("planning.listCycles", input),
    syncLinearProjects: (input) =>
      invoke("planning.syncLinearProjects", input),
    getCurrentUser: () => invoke("planning.getCurrentUser"),
    dispatch: {
      createBatch: (input) => invoke("planning.dispatch.createBatch", input),
      getBatch: (input) => invoke("planning.dispatch.getBatch", input),
      updateItemAgent: (input) =>
        invoke("planning.dispatch.updateItemAgent", input),
      updateConcurrency: (input) =>
        invoke("planning.dispatch.updateConcurrency", input),
      dispatch: (input) => invoke("planning.dispatch.dispatch", input),
      checkProgress: (input) =>
        invoke("planning.dispatch.checkProgress", input),
      listBatches: (input) => invoke("planning.dispatch.listBatches", input),
      resetPipelineState: (input) =>
        invoke("planning.dispatch.resetPipelineState", input),
    },
    session: {
      create: (input) => invoke("planning.session.create", input),
      start: (input) => invoke("planning.session.start", input),
      get: (input) => invoke("planning.session.get", input),
      list: (input) => invoke("planning.session.list", input),
      listByWorkItem: (input) =>
        invoke("planning.session.listByWorkItem", input),
      getActiveForWorkItem: (input) =>
        invoke("planning.session.getActiveForWorkItem", input),
      saveArtifact: (input) =>
        invoke("planning.session.saveArtifact", input),
      getPriorContext: (input) =>
        invoke("planning.session.getPriorContext", input),
      createDraft: (input) =>
        invoke("planning.session.createDraft", input),
      updateDraft: (input) =>
        invoke("planning.session.updateDraft", input),
      removeDraft: (input) =>
        invoke("planning.session.removeDraft", input),
      setDependency: (input) =>
        invoke("planning.session.setDependency", input),
      removeDependency: (input) =>
        invoke("planning.session.removeDependency", input),
      commitPlan: (input) =>
        invoke("planning.session.commitPlan", input),
      commitPlanLocal: (input) =>
        invoke("planning.session.commitPlanLocal", input),
    },
    task: {
      list: (input) => invoke("planning.task.list", input),
      byId: (input) => invoke("planning.task.byId", input),
      byWorktree: (input) => invoke("planning.task.byWorktree", input),
      create: (input) => invoke("planning.task.create", input),
      update: (input) => invoke("planning.task.update", input),
      delete: (input) => invoke("planning.task.delete", input),
      syncFromFile: (input) =>
        invoke("planning.task.syncFromFile", input),
      addTask: (input) => invoke("planning.task.addTask", input),
      updateTask: (input) => invoke("planning.task.updateTask", input),
      deleteTask: (input) => invoke("planning.task.deleteTask", input),
      reorderTasks: (input) =>
        invoke("planning.task.reorderTasks", input),
    },
    skill: {
      list: (input) => invoke("planning.skill.list", input),
      seed: (input) => invoke("planning.skill.seed", input),
      getExecution: (input) =>
        invoke("planning.skill.getExecution", input),
      listExecutions: (input) =>
        invoke("planning.skill.listExecutions", input),
      recordExecution: (input) =>
        invoke("planning.skill.recordExecution", input),
      updateExecution: (input) =>
        invoke("planning.skill.updateExecution", input),
    },
    snapshot: {
      create: (input) => invoke("planning.snapshot.create", input),
      list: (input) => invoke("planning.snapshot.list", input),
      get: (input) => invoke("planning.snapshot.get", input),
    },
    checkpoint: {
      create: (input) => invoke("planning.checkpoint.create", input),
      list: (input) => invoke("planning.checkpoint.list", input),
      branchFrom: (input) =>
        invoke("planning.checkpoint.branchFrom", input),
    },
  };
};
