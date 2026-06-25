/**
 * Aggregate layer that maps handler factory outputs to WorkItemsRpc contract
 * names (31 procedures).
 *
 * Imports the four handler factories (workItems, agentRun, requirement, link),
 * instantiates them with a HandlerContext, and wires each factory key to the
 * corresponding contract procedure name expected by WorkItemsRpc.toLayer().
 *
 * Phase 7B-4D-gamma Task 1.
 */
import type { HandlerContext } from "../handlers/context.js";
import { WorkItemsRpc } from "@gmacko/bob/contracts";
import { makeWorkItemsRpcHandlers } from "../rpc-handlers/workItems.js";
import { makeRequirementRpcHandlers } from "../rpc-handlers/requirement.js";
import { makeLinkRpcHandlers } from "../rpc-handlers/link.js";

export const makeWorkItemsLayer = (ctx: HandlerContext) => {
  const wi = makeWorkItemsRpcHandlers(ctx);
  const req = makeRequirementRpcHandlers(ctx);
  const lnk = makeLinkRpcHandlers(ctx);

  return WorkItemsRpc.toLayer({
    // --- Core (6) ---
    "workItem.list": wi["workItems.list"],
    "workItem.get": wi["workItems.get"],
    "workItem.update": wi["workItems.update"],
    "workItem.promoteToTask": wi["workItems.promoteToTask"],
    "workItem.comment.list": wi["workItems.listComments"],
    "workItem.comment.create": wi["workItems.createComment"],

    // --- Artifact (3) ---
    "workItem.artifact.create": wi["workItems.createArtifact"],
    "workItem.artifact.listCurrent": wi["workItems.listCurrentArtifacts"],
    "workItem.artifact.listChildGroups":
      wi["workItems.listChildArtifactGroups"],

    // --- Activity (2) ---
    "workItem.activity.list": wi["workItems.listActivities"],
    "workItem.activity.listRecent": wi["workItems.listRecentActivities"],

    // --- Notification (4) ---
    "workItem.notification.list": wi["workItems.listNotifications"],
    "workItem.notification.create": wi["workItems.createNotification"],
    "workItem.notification.markAsRead":
      wi["workItems.markNotificationAsRead"],
    "workItem.notification.registerPushToken":
      wi["workItems.registerPushToken"],

    // --- TaskRun (3) ---
    "workItem.taskRun.listByWorkItem":
      wi["workItems.taskRun.listByWorkItem"],
    "workItem.taskRun.execute": wi["workItems.taskRun.execute"],
    "workItem.taskRun.listLifecycleEvents":
      wi["workItems.taskRun.listLifecycleEvents"],

    // --- Requirement (5) ---
    "workItem.requirement.list": req["requirement.list"],
    "workItem.requirement.create": req["requirement.create"],
    "workItem.requirement.update": req["requirement.update"],
    "workItem.requirement.delete": req["requirement.delete"],
    "workItem.requirement.linkToTask": req["requirement.linkToTask"],

    // --- Link (8) ---
    "workItem.link.list": lnk["link.list"],
    "workItem.link.byId": lnk["link.byId"],
    "workItem.link.byWorktree": lnk["link.byWorktree"],
    "workItem.link.create": lnk["link.create"],
    "workItem.link.update": lnk["link.update"],
    "workItem.link.delete": lnk["link.delete"],
    "workItem.link.linkToPlanningTask": lnk["link.linkToPlanningTask"],
    "workItem.link.linkToGitHubPR": lnk["link.linkToGitHubPR"],
  } as any);
};
