// WorkItemsRpc — wire contract for Bob work-item operations.
// 7B-4C Task 1: 6 core + comment procedures.
// 7B-4C Task 2: 12 artifact/activity/notification/taskRun procedures (18 total).
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import { BobNotFoundError, BobForbiddenError } from "../errors.js";
import {
  WorkItemKindEnum,
  WorkItemRecordSchema,
  ArtifactRecordSchema,
  CommentRecordSchema,
  GetWorkItemResultSchema,
} from "../schemas/work-item-core.js";
import {
  ArtifactProducerTypeEnum,
  ArtifactTypeEnum,
  NotificationTypeEnum,
  PushPlatformEnum,
  ActivityRecordSchema,
  NotificationRecordSchema,
  TaskRunRecordSchema,
  LifecycleEventRecordSchema,
} from "../schemas/work-item-sub.js";

export const WorkItemListRpc = Rpc.make("workItem.list", {
  payload: Schema.Struct({
    workspaceId: Schema.String,
    projectId: Schema.optional(Schema.String),
    parentId: Schema.optional(Schema.NullOr(Schema.String)),
    kind: Schema.optional(WorkItemKindEnum),
    status: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(WorkItemRecordSchema),
  error: BobNotFoundError,
});

export const WorkItemGetRpc = Rpc.make("workItem.get", {
  payload: Schema.Struct({ id: Schema.String }),
  success: GetWorkItemResultSchema,
  error: BobNotFoundError,
});

export const WorkItemUpdateRpc = Rpc.make("workItem.update", {
  payload: Schema.Struct({
    id: Schema.String,
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.NullOr(Schema.String)),
    status: Schema.optional(Schema.String),
  }),
  success: Schema.NullOr(WorkItemRecordSchema),
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const WorkItemPromoteToTaskRpc = Rpc.make("workItem.promoteToTask", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.NullOr(WorkItemRecordSchema),
  error: BobNotFoundError,
});

export const WorkItemCommentListRpc = Rpc.make("workItem.comment.list", {
  payload: Schema.Struct({ workItemId: Schema.String }),
  success: Schema.Array(CommentRecordSchema),
  error: BobNotFoundError,
});

export const WorkItemCommentCreateRpc = Rpc.make("workItem.comment.create", {
  payload: Schema.Struct({
    workItemId: Schema.String,
    body: Schema.String,
    bodyHtml: Schema.optional(Schema.String),
    parentId: Schema.optional(Schema.String),
  }),
  success: CommentRecordSchema,
  error: BobNotFoundError,
});

// --- Artifact sub-namespace (Task 2) ---

export const WorkItemArtifactCreateRpc = Rpc.make("workItem.artifact.create", {
  payload: Schema.Struct({
    workItemId: Schema.String,
    taskRunId: Schema.optional(Schema.String),
    sessionId: Schema.optional(Schema.String),
    producerType: ArtifactProducerTypeEnum,
    producerId: Schema.optional(Schema.String),
    artifactType: ArtifactTypeEnum,
    artifactRole: Schema.String,
    url: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    summary: Schema.optional(Schema.String),
    content: Schema.optional(Schema.String),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  success: ArtifactRecordSchema,
  error: BobNotFoundError,
});

export const WorkItemArtifactListCurrentRpc = Rpc.make(
  "workItem.artifact.listCurrent",
  {
    payload: Schema.Struct({ workItemId: Schema.String }),
    success: Schema.Array(ArtifactRecordSchema),
    error: BobNotFoundError,
  },
);

export const WorkItemArtifactListChildGroupsRpc = Rpc.make(
  "workItem.artifact.listChildGroups",
  {
    payload: Schema.Struct({ parentWorkItemId: Schema.String }),
    success: Schema.Array(
      Schema.Struct({
        workItem: WorkItemRecordSchema,
        artifacts: Schema.Array(ArtifactRecordSchema),
      }),
    ),
    error: BobNotFoundError,
  },
);

// --- Activity sub-namespace (Task 2) ---

export const WorkItemActivityListRpc = Rpc.make("workItem.activity.list", {
  payload: Schema.Struct({
    workItemId: Schema.String,
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(ActivityRecordSchema),
  error: BobNotFoundError,
});

export const WorkItemActivityListRecentRpc = Rpc.make(
  "workItem.activity.listRecent",
  {
    payload: Schema.Struct({ limit: Schema.optional(Schema.Number) }),
    success: Schema.Array(ActivityRecordSchema),
    error: BobNotFoundError,
  },
);

// --- Notification sub-namespace (Task 2) ---

export const WorkItemNotificationListRpc = Rpc.make(
  "workItem.notification.list",
  {
    payload: Schema.Struct({
      unreadOnly: Schema.optional(Schema.Boolean),
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Struct({
      items: Schema.Array(NotificationRecordSchema),
    }),
    error: BobNotFoundError,
  },
);

export const WorkItemNotificationCreateRpc = Rpc.make(
  "workItem.notification.create",
  {
    payload: Schema.Struct({
      userId: Schema.String,
      workItemId: Schema.optional(Schema.String),
      actorId: Schema.optional(Schema.String),
      type: NotificationTypeEnum,
      title: Schema.String,
      body: Schema.optional(Schema.String),
      url: Schema.optional(Schema.String),
    }),
    success: NotificationRecordSchema,
    error: BobNotFoundError,
  },
);

export const WorkItemNotificationMarkAsReadRpc = Rpc.make(
  "workItem.notification.markAsRead",
  {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.NullOr(NotificationRecordSchema),
    error: BobNotFoundError,
  },
);

export const WorkItemNotificationRegisterPushTokenRpc = Rpc.make(
  "workItem.notification.registerPushToken",
  {
    payload: Schema.Struct({
      token: Schema.String,
      platform: PushPlatformEnum,
      deviceName: Schema.optional(Schema.String),
    }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: BobNotFoundError,
  },
);

// --- TaskRun sub-namespace (Task 2) ---

export const WorkItemTaskRunListByWorkItemRpc = Rpc.make(
  "workItem.taskRun.listByWorkItem",
  {
    payload: Schema.Struct({ workItemId: Schema.String }),
    success: Schema.Array(TaskRunRecordSchema),
    error: BobNotFoundError,
  },
);

export const WorkItemTaskRunExecuteRpc = Rpc.make(
  "workItem.taskRun.execute",
  {
    payload: Schema.Struct({
      workItemId: Schema.String,
      agentType: Schema.optional(Schema.String),
    }),
    success: TaskRunRecordSchema,
    error: BobNotFoundError,
  },
);

export const WorkItemTaskRunListLifecycleEventsRpc = Rpc.make(
  "workItem.taskRun.listLifecycleEvents",
  {
    payload: Schema.Struct({
      workItemId: Schema.String,
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Array(LifecycleEventRecordSchema),
    error: BobNotFoundError,
  },
);

export const WorkItemsRpc = RpcGroup.make(
  // Core (Task 1)
  WorkItemListRpc,
  WorkItemGetRpc,
  WorkItemUpdateRpc,
  WorkItemPromoteToTaskRpc,
  WorkItemCommentListRpc,
  WorkItemCommentCreateRpc,
  // Artifact (Task 2)
  WorkItemArtifactCreateRpc,
  WorkItemArtifactListCurrentRpc,
  WorkItemArtifactListChildGroupsRpc,
  // Activity (Task 2)
  WorkItemActivityListRpc,
  WorkItemActivityListRecentRpc,
  // Notification (Task 2)
  WorkItemNotificationListRpc,
  WorkItemNotificationCreateRpc,
  WorkItemNotificationMarkAsReadRpc,
  WorkItemNotificationRegisterPushTokenRpc,
  // TaskRun (Task 2)
  WorkItemTaskRunListByWorkItemRpc,
  WorkItemTaskRunExecuteRpc,
  WorkItemTaskRunListLifecycleEventsRpc,
);
