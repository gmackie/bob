import { ProjectsRpc } from "@gmacko/core/contracts/groups/projects";

import type { ClientRuntime } from "./internal/runtime.js";
import { makeInvoke, type RpcMethod } from "./internal/invoke.js";

export interface ProjectsClient extends Record<string, unknown> {
  readonly create: RpcMethod;
  readonly list: () => Promise<unknown>;
  readonly get: RpcMethod;
  readonly getBySlug: RpcMethod;
  readonly delete: RpcMethod;
  readonly discovery: RpcMethod;
  readonly updateAutomationSettings: RpcMethod;
  readonly setDefaultAgent: RpcMethod;
  readonly dismissDir: RpcMethod;
  readonly workspace: {
    readonly list: RpcMethod;
    readonly create: RpcMethod;
    readonly rename: RpcMethod;
    readonly setDefaultAgent: RpcMethod;
    readonly delete: RpcMethod;
  };
  readonly repository: Record<string, RpcMethod>;
  readonly pullRequest: {
    readonly list: RpcMethod;
    readonly get: RpcMethod;
    readonly listByRepository: RpcMethod;
    readonly listBySession: RpcMethod;
    readonly create: RpcMethod;
    readonly update: RpcMethod;
    readonly merge: RpcMethod;
    readonly syncCommits: RpcMethod;
    readonly linkToPlanningTask: RpcMethod;
    readonly refresh: RpcMethod;
    readonly listReviews: RpcMethod;
    readonly addReview: RpcMethod;
  };
  readonly featureBranch: {
    readonly create: RpcMethod;
    readonly get: RpcMethod;
    readonly list: RpcMethod;
    readonly addTaskPR: RpcMethod;
    readonly markTaskPRMerged: RpcMethod;
    readonly createFeaturePR: RpcMethod;
    readonly updateStatus: RpcMethod;
  };
  readonly gitProvider: {
    readonly listConnections: () => Promise<unknown>;
    readonly connectPat: RpcMethod;
    readonly disconnect: RpcMethod;
    readonly testConnection: RpcMethod;
    readonly setDefaultForRepo: RpcMethod;
    readonly detectRemote: RpcMethod;
  };
  readonly git: Record<string, RpcMethod>;
}

export const makeProjectsClient = (runtime: ClientRuntime): ProjectsClient => {
  const invoke = makeInvoke(runtime, ProjectsRpc);

  return {
    create: (input) => invoke("projects.create", input),
    list: () => invoke("projects.list"),
    get: (input) => invoke("projects.get", input),
    getBySlug: (input) => invoke("projects.getBySlug", input),
    delete: (input) => invoke("projects.delete", input),
    discovery: (input) => invoke("projects.discovery", input),
    updateAutomationSettings: (input) =>
      invoke("projects.updateAutomationSettings", input),
    setDefaultAgent: (input) =>
      invoke("projects.setDefaultAgent", input),
    dismissDir: (input) => invoke("projects.dismissDir", input),
    workspace: {
      list: (input) => invoke("projects.workspace.list", input),
      create: (input) => invoke("projects.workspace.create", input),
      rename: (input) => invoke("projects.workspace.rename", input),
      setDefaultAgent: (input) =>
        invoke("projects.workspace.setDefaultAgent", input),
      delete: (input) => invoke("projects.workspace.delete", input),
    },
    repository: {
      list: (input) => invoke("projects.repository.list", input),
      byId: (input) => invoke("projects.repository.byId", input),
      add: (input) => invoke("projects.repository.add", input),
      addFromProvider: (input) =>
        invoke("projects.repository.addFromProvider", input),
      delete: (input) => invoke("projects.repository.delete", input),
      refreshMainBranch: (input) =>
        invoke("projects.repository.refreshMainBranch", input),
      getWorktrees: (input) =>
        invoke("projects.repository.getWorktrees", input),
      createWorktree: (input) =>
        invoke("projects.repository.createWorktree", input),
      getWorktreePlanning: (input) =>
        invoke("projects.repository.getWorktreePlanning", input),
      updateWorktreePlanning: (input) =>
        invoke("projects.repository.updateWorktreePlanning", input),
      deleteWorktree: (input) =>
        invoke("projects.repository.deleteWorktree", input),
      getWorktreeMergeStatus: (input) =>
        invoke("projects.repository.getWorktreeMergeStatus", input),
    },
    pullRequest: {
      list: (input) => invoke("projects.pullRequest.list", input),
      get: (input) => invoke("projects.pullRequest.get", input),
      listByRepository: (input) =>
        invoke("projects.pullRequest.listByRepository", input),
      listBySession: (input) =>
        invoke("projects.pullRequest.listBySession", input),
      create: (input) => invoke("projects.pullRequest.create", input),
      update: (input) => invoke("projects.pullRequest.update", input),
      merge: (input) => invoke("projects.pullRequest.merge", input),
      syncCommits: (input) =>
        invoke("projects.pullRequest.syncCommits", input),
      linkToPlanningTask: (input) =>
        invoke("projects.pullRequest.linkToPlanningTask", input),
      refresh: (input) => invoke("projects.pullRequest.refresh", input),
      listReviews: (input) =>
        invoke("projects.pullRequest.listReviews", input),
      addReview: (input) =>
        invoke("projects.pullRequest.addReview", input),
    },
    featureBranch: {
      create: (input) => invoke("projects.featureBranch.create", input),
      get: (input) => invoke("projects.featureBranch.get", input),
      list: (input) => invoke("projects.featureBranch.list", input),
      addTaskPR: (input) =>
        invoke("projects.featureBranch.addTaskPR", input),
      markTaskPRMerged: (input) =>
        invoke("projects.featureBranch.markTaskPRMerged", input),
      createFeaturePR: (input) =>
        invoke("projects.featureBranch.createFeaturePR", input),
      updateStatus: (input) =>
        invoke("projects.featureBranch.updateStatus", input),
    },
    gitProvider: {
      listConnections: () =>
        invoke("projects.gitProvider.listConnections"),
      connectPat: (input) =>
        invoke("projects.gitProvider.connectPat", input),
      disconnect: (input) =>
        invoke("projects.gitProvider.disconnect", input),
      testConnection: (input) =>
        invoke("projects.gitProvider.testConnection", input),
      setDefaultForRepo: (input) =>
        invoke("projects.gitProvider.setDefaultForRepo", input),
      detectRemote: (input) =>
        invoke("projects.gitProvider.detectRemote", input),
    },
    git: {
      pushAndCreatePr: (input) =>
        invoke("projects.git.pushAndCreatePr", input),
      jjIsRepo: (input) => invoke("projects.git.jjIsRepo", input),
      jjLog: (input) => invoke("projects.git.jjLog", input),
      jjNew: (input) => invoke("projects.git.jjNew", input),
      jjDescribe: (input) => invoke("projects.git.jjDescribe", input),
      jjSquash: (input) => invoke("projects.git.jjSquash", input),
      jjDiff: (input) => invoke("projects.git.jjDiff", input),
    },
  };
};
