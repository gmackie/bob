/**
 * Effect-RPC handler functions for the workItems RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 9.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  workItemsList,
  workItemsGet,
  workItemsUpdate,
  workItemsPromoteToTask,
  workItemsDispatch,
  workItemsListComments,
  workItemsCreateComment,
  workItemsCreateArtifact,
  workItemsListActivities,
  workItemsListCurrentArtifacts,
  workItemsListChildArtifactGroups,
  workItemsListNotifications,
  workItemsCreateNotification,
  workItemsMarkNotificationAsRead,
  workItemsRegisterPushToken,
  workItemsTaskRunListByWorkItem,
  workItemsTaskRunExecute,
  workItemsTaskRunListLifecycleEvents,
  workItemsListRecentActivities,
} from "../handlers/workItems.js";

type WorkItemKind = "issue" | "task" | "epic";

export const makeWorkItemsRpcHandlers = (ctx: HandlerContext) => ({
  "workItems.list": ({
    payload,
  }: {
    payload: {
      workspaceId: string;
      projectId?: string;
      parentId?: string | null;
      kind?: WorkItemKind;
      status?: string;
      limit?: number;
    };
  }) => wrapHandler(workItemsList, ctx, payload, "workItem"),

  "workItems.get": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(workItemsGet, ctx, payload, "workItem"),

  "workItems.update": ({
    payload,
  }: {
    payload: {
      id: string;
      title?: string;
      description?: string;
      status?: string;
    };
  }) => wrapHandler(workItemsUpdate, ctx, payload, "workItem"),

  "workItems.promoteToTask": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(workItemsPromoteToTask, ctx, payload, "workItem"),

  "workItems.dispatch": ({
    payload,
  }: {
    payload: { workItemId: string; agentType?: string };
  }) => wrapHandler(workItemsDispatch, ctx, payload, "workItem"),

  "workItems.listComments": ({
    payload,
  }: {
    payload: { workItemId: string };
  }) => wrapHandler(workItemsListComments, ctx, payload, "comment"),

  "workItems.createComment": ({
    payload,
  }: {
    payload: {
      workItemId: string;
      parentId?: string | null;
      body: string;
      bodyHtml?: string | null;
    };
  }) => wrapHandler(workItemsCreateComment, ctx, payload, "comment"),

  "workItems.createArtifact": ({
    payload,
  }: {
    payload: {
      workItemId: string;
      taskRunId?: string | null;
      sessionId?: string | null;
      producerType: string;
      producerId?: string | null;
      artifactType: string;
      artifactRole: string;
      url?: string | null;
      title?: string | null;
      summary?: string | null;
      content?: string | null;
      metadata?: unknown;
    };
  }) => wrapHandler(workItemsCreateArtifact, ctx, payload, "artifact"),

  "workItems.listActivities": ({
    payload,
  }: {
    payload: { workItemId: string; limit?: number };
  }) => wrapHandler(workItemsListActivities, ctx, payload, "activity"),

  "workItems.listCurrentArtifacts": ({
    payload,
  }: {
    payload: { workItemId: string };
  }) => wrapHandler(workItemsListCurrentArtifacts, ctx, payload, "artifact"),

  "workItems.listChildArtifactGroups": ({
    payload,
  }: {
    payload: { parentWorkItemId: string };
  }) => wrapHandler(workItemsListChildArtifactGroups, ctx, payload, "artifact"),

  "workItems.listNotifications": ({
    payload,
  }: {
    payload: { unreadOnly?: boolean; limit?: number };
  }) => wrapHandler(workItemsListNotifications, ctx, payload, "notification"),

  "workItems.createNotification": ({
    payload,
  }: {
    payload: {
      userId: string;
      workItemId?: string | null;
      actorId?: string | null;
      type: string;
      title: string;
      body?: string | null;
      url?: string | null;
    };
  }) => wrapHandler(workItemsCreateNotification, ctx, payload, "notification"),

  "workItems.markNotificationAsRead": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(workItemsMarkNotificationAsRead, ctx, payload, "notification"),

  "workItems.registerPushToken": ({
    payload,
  }: {
    payload: {
      token: string;
      platform: "ios" | "android" | "web";
      deviceName?: string;
    };
  }) => wrapHandler(workItemsRegisterPushToken, ctx, payload, "notification"),

  "workItems.taskRun.listByWorkItem": ({
    payload,
  }: {
    payload: { workItemId: string };
  }) => wrapHandler(workItemsTaskRunListByWorkItem, ctx, payload, "taskRun"),

  "workItems.taskRun.execute": ({
    payload,
  }: {
    payload: { workItemId: string; agentType?: string };
  }) => wrapHandler(workItemsTaskRunExecute, ctx, payload, "taskRun"),

  "workItems.taskRun.listLifecycleEvents": ({
    payload,
  }: {
    payload: { workItemId: string; limit?: number };
  }) => wrapHandler(workItemsTaskRunListLifecycleEvents, ctx, payload, "taskRun"),

  "workItems.listRecentActivities": ({
    payload,
  }: {
    payload: { limit?: number; workspaceId?: string };
  }) => wrapHandler(workItemsListRecentActivities, ctx, payload, "activity"),
});
