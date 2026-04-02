import { z } from "zod/v4";

import {
  workItemArtifactProducerType,
  workItemArtifactType,
  workItemNotificationType,
} from "@bob/db/schema";

const dateTimeStringSchema = z.string().datetime();
const metadataSchema = z.record(z.string(), z.unknown()).nullable().optional();

export const projectSummarySchema = z
  .object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
  })
  .passthrough();

export const workItemRecordSchema = z
  .object({
    id: z.string(),
    identifier: z.string().optional(),
    title: z.string(),
    description: z.string().nullable().optional(),
    kind: z.string(),
    status: z.string(),
    priority: z.string().optional(),
    sequenceNumber: z.number().int().nullable().optional(),
    projectId: z.string().nullable().optional(),
    ownerUserId: z.string().nullable().optional(),
    workspaceId: z.string().nullable().optional(),
    parentId: z.string().nullable().optional(),
    project: projectSummarySchema.nullable().optional(),
    createdAt: dateTimeStringSchema.optional(),
    updatedAt: dateTimeStringSchema.optional(),
  })
  .passthrough();

export const commentRecordSchema = z
  .object({
    id: z.string(),
    workItemId: z.string(),
    userId: z.string(),
    parentId: z.string().nullable().optional(),
    body: z.string(),
    bodyHtml: z.string().nullable().optional(),
    createdAt: dateTimeStringSchema.optional(),
    updatedAt: dateTimeStringSchema.optional(),
  })
  .passthrough();

export const artifactRecordSchema = z
  .object({
    id: z.string(),
    workItemId: z.string(),
    taskRunId: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    producerType: z.string(),
    producerId: z.string().nullable().optional(),
    artifactType: z.string(),
    artifactRole: z.string(),
    title: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    isCurrent: z.boolean().optional(),
    metadata: metadataSchema,
    createdAt: dateTimeStringSchema.optional(),
  })
  .passthrough();

export const activityRecordSchema = z
  .object({
    id: z.string(),
    workItemId: z.string(),
    userId: z.string().nullable().optional(),
    type: z.string(),
    fromValue: z.string().nullable().optional(),
    toValue: z.string().nullable().optional(),
    metadata: metadataSchema,
    createdAt: dateTimeStringSchema.optional(),
  })
  .passthrough();

export const notificationRecordSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    workItemId: z.string().nullable().optional(),
    actorId: z.string().nullable().optional(),
    type: z.string(),
    title: z.string(),
    body: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    read: z.boolean().optional(),
    readAt: dateTimeStringSchema.nullable().optional(),
    createdAt: dateTimeStringSchema.optional(),
  })
  .passthrough();

export const listWorkItemsInputSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  parentId: z.string().uuid().nullable().optional(),
  kind: z.enum(["issue", "epic", "task"]).optional(),
  status: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
});

export const getWorkItemInputSchema = z.object({
  id: z.string(),
});

export const promoteToTaskInputSchema = z.object({
  id: z.string().uuid(),
});

export const listCommentsInputSchema = z.object({
  workItemId: z.string().uuid(),
});

export const createCommentInputSchema = z.object({
  workItemId: z.string().uuid(),
  body: z.string().min(1).max(10000),
  bodyHtml: z.string().optional(),
  parentId: z.string().uuid().optional(),
});

export const createArtifactInputSchema = z.object({
  workItemId: z.string().uuid(),
  taskRunId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  producerType: z.enum(workItemArtifactProducerType),
  producerId: z.string().optional(),
  artifactType: z.enum(workItemArtifactType),
  artifactRole: z.string().min(1),
  url: z.string().url().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  content: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const listActivitiesInputSchema = z.object({
  workItemId: z.string().uuid(),
  limit: z.number().min(1).max(100).default(50),
});

export const listCurrentArtifactsInputSchema = z.object({
  workItemId: z.string().uuid(),
});

export const listChildArtifactGroupsInputSchema = z.object({
  parentWorkItemId: z.string().uuid(),
});

export const listNotificationsInputSchema = z.object({
  unreadOnly: z.boolean().default(false),
  limit: z.number().min(1).max(100).default(50),
});

export const createNotificationInputSchema = z.object({
  userId: z.string(),
  workItemId: z.string().uuid().optional(),
  actorId: z.string().optional(),
  type: z.enum(workItemNotificationType),
  title: z.string().min(1).max(256),
  body: z.string().optional(),
  url: z.string().url().optional(),
});

export const markNotificationAsReadInputSchema = z.object({
  id: z.string().uuid(),
});

export const getWorkItemOutputSchema = z
  .object({
    workItem: workItemRecordSchema,
    currentArtifacts: z.array(artifactRecordSchema),
    childCount: z.number().int().nonnegative(),
  })
  .nullable();

export const listNotificationsOutputSchema = z.object({
  items: z.array(notificationRecordSchema),
});

export const listChildArtifactGroupsOutputSchema = z.array(
  z.object({
    workItem: workItemRecordSchema,
    artifacts: z.array(artifactRecordSchema),
  }),
);

export type WorkItemsRestOperation = {
  procedureName:
    | "list"
    | "get"
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
};

export const workItemsRestOperations: WorkItemsRestOperation[] = [
  {
    procedureName: "list",
    procedurePath: "publicWorkItems.list",
    restPath: "/api/v1/work-items/list",
    summary: "List work items",
    auth: "apiKey",
    inputSchema: listWorkItemsInputSchema,
    outputSchema: z.array(workItemRecordSchema),
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
    procedureName: "promoteToTask",
    procedurePath: "publicWorkItems.promoteToTask",
    restPath: "/api/v1/work-items/promote-to-task",
    summary: "Promote a work item to a task",
    auth: "apiKey",
    inputSchema: promoteToTaskInputSchema,
    outputSchema: workItemRecordSchema.nullable(),
  },
  {
    procedureName: "listComments",
    procedurePath: "publicWorkItems.listComments",
    restPath: "/api/v1/work-items/list-comments",
    summary: "List work item comments",
    auth: "apiKey",
    inputSchema: listCommentsInputSchema,
    outputSchema: z.array(commentRecordSchema),
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
    outputSchema: z.array(activityRecordSchema),
  },
  {
    procedureName: "listCurrentArtifacts",
    procedurePath: "publicWorkItems.listCurrentArtifacts",
    restPath: "/api/v1/work-items/list-current-artifacts",
    summary: "List current work item artifacts",
    auth: "apiKey",
    inputSchema: listCurrentArtifactsInputSchema,
    outputSchema: z.array(artifactRecordSchema),
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
    outputSchema: notificationRecordSchema,
  },
  {
    procedureName: "markNotificationAsRead",
    procedurePath: "publicWorkItems.markNotificationAsRead",
    restPath: "/api/v1/work-items/mark-notification-as-read",
    summary: "Mark a work item notification as read",
    auth: "apiKey",
    inputSchema: markNotificationAsReadInputSchema,
    outputSchema: notificationRecordSchema.nullable(),
  },
];

export const workItemsRestOperationByPath = new Map(
  workItemsRestOperations.map((operation) => [operation.restPath, operation]),
);
