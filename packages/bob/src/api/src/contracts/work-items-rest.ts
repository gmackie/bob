import type { z } from "zod/v4";

import {
  commentRecordSchema,
  artifactRecordSchema,
  createArtifactInputSchema,
  createCommentInputSchema,
  createNotificationInputSchema,
  createNotificationOutputSchema,
  getWorkItemInputSchema,
  getWorkItemOutputSchema,
  listActivitiesInputSchema,
  listActivitiesOutputSchema,
  listChildArtifactGroupsInputSchema,
  listChildArtifactGroupsOutputSchema,
  listCommentsInputSchema,
  listCommentsOutputSchema,
  listCurrentArtifactsInputSchema,
  listCurrentArtifactsOutputSchema,
  listNotificationsInputSchema,
  listNotificationsOutputSchema,
  listWorkItemsInputSchema,
  listWorkItemsOutputSchema,
  markNotificationAsReadInputSchema,
  markNotificationAsReadOutputSchema,
  promoteToTaskInputSchema,
  promoteToTaskOutputSchema,
  updateWorkItemInputSchema,
  updateWorkItemOutputSchema,
} from "@bob/work-items/schema";

export interface WorkItemsRestOperation {
  procedureName:
    | "list"
    | "get"
    | "update"
    | "promoteToTask"
    | "listComments"
    | "createComment"
    | "createArtifact"
    | "listActivities"
    | "listCurrentArtifacts"
    | "listChildArtifactGroups"
    | "listNotifications"
    | "createNotification"
    | "markNotificationAsRead";
  procedurePath: `publicWorkItems.${string}`;
  restPath: `/api/v1/work-items/${string}`;
  summary: string;
  auth: "session" | "apiKey";
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
}

export const workItemsRestOperations: WorkItemsRestOperation[] = [
  {
    procedureName: "list",
    procedurePath: "publicWorkItems.list",
    restPath: "/api/v1/work-items/list",
    summary: "List work items",
    auth: "apiKey",
    inputSchema: listWorkItemsInputSchema,
    outputSchema: listWorkItemsOutputSchema,
  },
  {
    procedureName: "get",
    procedurePath: "publicWorkItems.get",
    restPath: "/api/v1/work-items/get",
    summary: "Get a work item",
    auth: "apiKey",
    inputSchema: getWorkItemInputSchema,
    outputSchema: getWorkItemOutputSchema,
  },
  {
    procedureName: "update",
    procedurePath: "publicWorkItems.update",
    restPath: "/api/v1/work-items/update",
    summary: "Update a work item",
    auth: "apiKey",
    inputSchema: updateWorkItemInputSchema,
    outputSchema: updateWorkItemOutputSchema,
  },
  {
    procedureName: "promoteToTask",
    procedurePath: "publicWorkItems.promoteToTask",
    restPath: "/api/v1/work-items/promote-to-task",
    summary: "Promote a work item to a task",
    auth: "apiKey",
    inputSchema: promoteToTaskInputSchema,
    outputSchema: promoteToTaskOutputSchema,
  },
  {
    procedureName: "listComments",
    procedurePath: "publicWorkItems.listComments",
    restPath: "/api/v1/work-items/list-comments",
    summary: "List work item comments",
    auth: "apiKey",
    inputSchema: listCommentsInputSchema,
    outputSchema: listCommentsOutputSchema,
  },
  {
    procedureName: "createComment",
    procedurePath: "publicWorkItems.createComment",
    restPath: "/api/v1/work-items/create-comment",
    summary: "Create a work item comment",
    auth: "apiKey",
    inputSchema: createCommentInputSchema,
    outputSchema: commentRecordSchema,
  },
  {
    procedureName: "createArtifact",
    procedurePath: "publicWorkItems.createArtifact",
    restPath: "/api/v1/work-items/create-artifact",
    summary: "Create a work item artifact",
    auth: "apiKey",
    inputSchema: createArtifactInputSchema,
    outputSchema: artifactRecordSchema,
  },
  {
    procedureName: "listActivities",
    procedurePath: "publicWorkItems.listActivities",
    restPath: "/api/v1/work-items/list-activities",
    summary: "List work item activities",
    auth: "apiKey",
    inputSchema: listActivitiesInputSchema,
    outputSchema: listActivitiesOutputSchema,
  },
  {
    procedureName: "listCurrentArtifacts",
    procedurePath: "publicWorkItems.listCurrentArtifacts",
    restPath: "/api/v1/work-items/list-current-artifacts",
    summary: "List current work item artifacts",
    auth: "apiKey",
    inputSchema: listCurrentArtifactsInputSchema,
    outputSchema: listCurrentArtifactsOutputSchema,
  },
  {
    procedureName: "listChildArtifactGroups",
    procedurePath: "publicWorkItems.listChildArtifactGroups",
    restPath: "/api/v1/work-items/list-child-artifact-groups",
    summary: "List child work item artifact groups",
    auth: "apiKey",
    inputSchema: listChildArtifactGroupsInputSchema,
    outputSchema: listChildArtifactGroupsOutputSchema,
  },
  {
    procedureName: "listNotifications",
    procedurePath: "publicWorkItems.listNotifications",
    restPath: "/api/v1/work-items/list-notifications",
    summary: "List work item notifications",
    auth: "apiKey",
    inputSchema: listNotificationsInputSchema,
    outputSchema: listNotificationsOutputSchema,
  },
  {
    procedureName: "createNotification",
    procedurePath: "publicWorkItems.createNotification",
    restPath: "/api/v1/work-items/create-notification",
    summary: "Create a work item notification",
    auth: "apiKey",
    inputSchema: createNotificationInputSchema,
    outputSchema: createNotificationOutputSchema,
  },
  {
    procedureName: "markNotificationAsRead",
    procedurePath: "publicWorkItems.markNotificationAsRead",
    restPath: "/api/v1/work-items/mark-notification-as-read",
    summary: "Mark a work item notification as read",
    auth: "apiKey",
    inputSchema: markNotificationAsReadInputSchema,
    outputSchema: markNotificationAsReadOutputSchema,
  },
];

export const workItemsRestOperationByPath = new Map(
  workItemsRestOperations.map((operation) => [operation.restPath, operation]),
);
