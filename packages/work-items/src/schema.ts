import { z } from "zod/v4";

const dateTimeStringSchema = z.string().datetime();
const metadataSchema = z.record(z.string(), z.unknown()).nullable().optional();

export const workItemArtifactProducerType = [
  "task_run",
  "session",
  "integration",
  "manual",
] as const;

export const workItemArtifactType = [
  "pr",
  "verification",
  "build",
  "test_report",
  "doc",
  "deliverable",
  "planning_doc",
  "code_review",
  "other",
] as const;

export const workItemNotificationType = [
  "work_item_assigned",
  "work_item_commented",
  "work_item_needs_input",
  "work_item_review_ready",
  "task_completed",
  "batch_completed",
] as const;

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

export const updateWorkItemInputSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(256).optional(),
    description: z.string().nullable().optional(),
    status: z.string().min(1).max(128).optional(),
  })
  .refine(
    (input) =>
      input.title !== undefined ||
      input.description !== undefined ||
      input.status !== undefined,
    {
      message: "At least one editable field is required",
    },
  );

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

export const listWorkItemsOutputSchema = z.array(workItemRecordSchema);

export const getWorkItemOutputSchema = z
  .object({
    workItem: workItemRecordSchema,
    currentArtifacts: z.array(artifactRecordSchema),
    childCount: z.number().int().nonnegative(),
  })
  .nullable();

export const updateWorkItemOutputSchema = workItemRecordSchema.nullable();
export const promoteToTaskOutputSchema = workItemRecordSchema.nullable();
export const listCommentsOutputSchema = z.array(commentRecordSchema);
export const createCommentOutputSchema = commentRecordSchema;
export const createArtifactOutputSchema = artifactRecordSchema;
export const listActivitiesOutputSchema = z.array(activityRecordSchema);
export const listCurrentArtifactsOutputSchema = z.array(artifactRecordSchema);
export const listNotificationsOutputSchema = z.object({
  items: z.array(notificationRecordSchema),
});
export const createNotificationOutputSchema = notificationRecordSchema;
export const markNotificationAsReadOutputSchema = notificationRecordSchema.nullable();

export const listChildArtifactGroupsOutputSchema = z.array(
  z.object({
    workItem: workItemRecordSchema,
    artifacts: z.array(artifactRecordSchema),
  }),
);

export type ListWorkItemsInput = z.infer<typeof listWorkItemsInputSchema>;
export type ListWorkItemsResult = z.infer<typeof listWorkItemsOutputSchema>;
export type GetWorkItemInput = z.infer<typeof getWorkItemInputSchema>;
export type GetWorkItemResult = z.infer<typeof getWorkItemOutputSchema>;
export type UpdateWorkItemInput = z.infer<typeof updateWorkItemInputSchema>;
export type UpdateWorkItemResult = z.infer<typeof updateWorkItemOutputSchema>;
export type PromoteToTaskInput = z.infer<typeof promoteToTaskInputSchema>;
export type PromoteToTaskResult = z.infer<typeof promoteToTaskOutputSchema>;
export type ListCommentsInput = z.infer<typeof listCommentsInputSchema>;
export type ListCommentsResult = z.infer<typeof listCommentsOutputSchema>;
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;
export type CreateCommentResult = z.infer<typeof createCommentOutputSchema>;
export type CreateArtifactInput = z.infer<typeof createArtifactInputSchema>;
export type CreateArtifactResult = z.infer<typeof createArtifactOutputSchema>;
export type ListActivitiesInput = z.infer<typeof listActivitiesInputSchema>;
export type ListActivitiesResult = z.infer<typeof listActivitiesOutputSchema>;
export type ListCurrentArtifactsInput = z.infer<
  typeof listCurrentArtifactsInputSchema
>;
export type ListCurrentArtifactsResult = z.infer<
  typeof listCurrentArtifactsOutputSchema
>;
export type ListChildArtifactGroupsInput = z.infer<
  typeof listChildArtifactGroupsInputSchema
>;
export type ListChildArtifactGroupsResult = z.infer<
  typeof listChildArtifactGroupsOutputSchema
>;
export type ListNotificationsInput = z.infer<typeof listNotificationsInputSchema>;
export type ListNotificationsResult = z.infer<
  typeof listNotificationsOutputSchema
>;
export type CreateNotificationInput = z.infer<
  typeof createNotificationInputSchema
>;
export type CreateNotificationResult = z.infer<
  typeof createNotificationOutputSchema
>;
export type MarkNotificationAsReadInput = z.infer<
  typeof markNotificationAsReadInputSchema
>;
export type MarkNotificationAsReadResult = z.infer<
  typeof markNotificationAsReadOutputSchema
>;
