// Effect Schema definitions for Bob work-item sub-namespaces:
// artifact, activity, notification, taskRun.
// Translated from Zod schemas in packages/bob/src/work-items/src/schema.ts.
// 7B-4C Task 2.
import { Schema } from "effect";

export const ArtifactProducerTypeEnum = Schema.Literals([
  "task_run",
  "session",
  "integration",
  "manual",
]);

export const ArtifactTypeEnum = Schema.Literals([
  "pr",
  "verification",
  "build",
  "test_report",
  "doc",
  "deliverable",
  "planning_doc",
  "code_review",
  "other",
]);

export const NotificationTypeEnum = Schema.Literals([
  "work_item_assigned",
  "work_item_commented",
  "work_item_needs_input",
  "work_item_review_ready",
  "task_completed",
  "batch_completed",
]);

export const PushPlatformEnum = Schema.Literals(["ios", "android", "web"]);

export const TaskRunStatusEnum = Schema.Literals([
  "starting",
  "running",
  "blocked",
  "completed",
  "failed",
]);

export const ActivityRecordSchema = Schema.Struct({
  id: Schema.String,
  workItemId: Schema.String,
  userId: Schema.optional(Schema.NullOr(Schema.String)),
  type: Schema.String,
  fromValue: Schema.optional(Schema.NullOr(Schema.String)),
  toValue: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(
    Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  ),
  createdAt: Schema.optional(Schema.String),
});

export const NotificationRecordSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  workItemId: Schema.optional(Schema.NullOr(Schema.String)),
  actorId: Schema.optional(Schema.NullOr(Schema.String)),
  type: Schema.String,
  title: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  read: Schema.optional(Schema.Boolean),
  readAt: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
});

export const TaskRunRecordSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  workItemId: Schema.optional(Schema.NullOr(Schema.String)),
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.String,
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});

export const LifecycleEventRecordSchema = Schema.Struct({
  id: Schema.String,
  taskRunId: Schema.String,
  eventType: Schema.String,
  metadata: Schema.optional(
    Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  ),
  createdAt: Schema.optional(Schema.String),
});
