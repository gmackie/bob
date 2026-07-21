import { WorkItemsRpc } from "@gmacko/bob/contracts";

import type { ClientRuntime } from "./internal/runtime.js";
import { makeInvoke, type RpcMethod } from "./internal/invoke.js";

export interface WorkItemsClient {
  readonly list: RpcMethod;
  readonly statusCounts: RpcMethod;
  readonly get: RpcMethod;
  readonly update: RpcMethod;
  readonly promoteToTask: RpcMethod;
  readonly comment: {
    readonly list: RpcMethod;
    readonly create: RpcMethod;
  };
  readonly artifact: {
    readonly create: RpcMethod;
    readonly listCurrent: RpcMethod;
    readonly listChildGroups: RpcMethod;
  };
  readonly activity: {
    readonly list: RpcMethod;
    readonly listRecent: RpcMethod;
  };
  readonly notification: {
    readonly list: RpcMethod;
    readonly create: RpcMethod;
    readonly markAsRead: RpcMethod;
    readonly markAllAsRead: RpcMethod;
    readonly registerPushToken: RpcMethod;
  };
  readonly taskRun: {
    readonly listByWorkItem: RpcMethod;
    readonly execute: RpcMethod;
    readonly listLifecycleEvents: RpcMethod;
  };
  readonly requirement: {
    readonly list: RpcMethod;
    readonly create: RpcMethod;
    readonly update: RpcMethod;
    readonly delete: RpcMethod;
    readonly linkToTask: RpcMethod;
  };
  readonly link: {
    readonly list: RpcMethod;
    readonly byId: RpcMethod;
    readonly byWorktree: RpcMethod;
    readonly create: RpcMethod;
    readonly update: RpcMethod;
    readonly delete: RpcMethod;
    readonly linkToPlanningTask: RpcMethod;
    readonly linkToGitHubPR: RpcMethod;
  };
}

export const makeWorkItemsClient = (
  runtime: ClientRuntime,
): WorkItemsClient => {
  const invoke = makeInvoke(runtime, WorkItemsRpc);

  return {
    list: (input) => invoke("workItem.list", input),
    statusCounts: (input) => invoke("workItem.statusCounts", input),
    get: (input) => invoke("workItem.get", input),
    update: (input) => invoke("workItem.update", input),
    promoteToTask: (input) => invoke("workItem.promoteToTask", input),
    comment: {
      list: (input) => invoke("workItem.comment.list", input),
      create: (input) => invoke("workItem.comment.create", input),
    },
    artifact: {
      create: (input) => invoke("workItem.artifact.create", input),
      listCurrent: (input) => invoke("workItem.artifact.listCurrent", input),
      listChildGroups: (input) =>
        invoke("workItem.artifact.listChildGroups", input),
    },
    activity: {
      list: (input) => invoke("workItem.activity.list", input),
      listRecent: (input) => invoke("workItem.activity.listRecent", input),
    },
    notification: {
      list: (input) => invoke("workItem.notification.list", input),
      create: (input) => invoke("workItem.notification.create", input),
      markAsRead: (input) =>
        invoke("workItem.notification.markAsRead", input),
      markAllAsRead: (input) =>
        invoke("workItem.notification.markAllAsRead", input ?? {}),
      registerPushToken: (input) =>
        invoke("workItem.notification.registerPushToken", input),
    },
    taskRun: {
      listByWorkItem: (input) =>
        invoke("workItem.taskRun.listByWorkItem", input),
      execute: (input) => invoke("workItem.taskRun.execute", input),
      listLifecycleEvents: (input) =>
        invoke("workItem.taskRun.listLifecycleEvents", input),
    },
    requirement: {
      list: (input) => invoke("workItem.requirement.list", input),
      create: (input) => invoke("workItem.requirement.create", input),
      update: (input) => invoke("workItem.requirement.update", input),
      delete: (input) => invoke("workItem.requirement.delete", input),
      linkToTask: (input) =>
        invoke("workItem.requirement.linkToTask", input),
    },
    link: {
      list: (input) => invoke("workItem.link.list", input),
      byId: (input) => invoke("workItem.link.byId", input),
      byWorktree: (input) => invoke("workItem.link.byWorktree", input),
      create: (input) => invoke("workItem.link.create", input),
      update: (input) => invoke("workItem.link.update", input),
      delete: (input) => invoke("workItem.link.delete", input),
      linkToPlanningTask: (input) =>
        invoke("workItem.link.linkToPlanningTask", input),
      linkToGitHubPR: (input) =>
        invoke("workItem.link.linkToGitHubPR", input),
    },
  };
};
