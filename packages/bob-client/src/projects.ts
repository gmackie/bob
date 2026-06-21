import { ProjectsRpc } from "@gmacko/core/contracts/groups/projects";

import type { ClientRuntime } from "./internal/runtime.js";
import { makeInvoke, type RpcMethod } from "./internal/invoke.js";

export interface ProjectsClient extends Record<string, unknown> {
  readonly create: RpcMethod;
  readonly list: () => Promise<unknown>;
  readonly get: RpcMethod;
  readonly getBySlug: RpcMethod;
  readonly delete: RpcMethod;
  readonly workspace: Record<string, RpcMethod>;
  readonly repository: Record<string, RpcMethod>;
  readonly pullRequest: Record<string, RpcMethod>;
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
    workspace: {
      list: (input) => invoke("projects.workspace.list", input),
      create: (input) => invoke("projects.workspace.create", input),
      rename: (input) => invoke("projects.workspace.rename", input),
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
