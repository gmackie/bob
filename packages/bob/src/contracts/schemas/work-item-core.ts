// Effect Schema definitions for Bob work-item domain objects.
// Translated from Zod schemas in packages/bob/src/work-items/src/schema.ts.
// 7B-4C Task 1.
import { Schema } from "effect";

export const WorkItemKindEnum = Schema.Literals(["issue", "epic", "task"]);

export const ProjectSummarySchema = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  name: Schema.String,
});

export const WorkItemRecordSchema = Schema.Struct({
  id: Schema.String,
  identifier: Schema.optional(Schema.String),
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  kind: Schema.String,
  status: Schema.String,
  priority: Schema.optional(Schema.String),
  sequenceNumber: Schema.optional(Schema.NullOr(Schema.Number)),
  projectId: Schema.optional(Schema.NullOr(Schema.String)),
  ownerUserId: Schema.optional(Schema.NullOr(Schema.String)),
  workspaceId: Schema.optional(Schema.NullOr(Schema.String)),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  project: Schema.optional(Schema.NullOr(ProjectSummarySchema)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});

export const CommentRecordSchema = Schema.Struct({
  id: Schema.String,
  workItemId: Schema.String,
  userId: Schema.String,
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  body: Schema.String,
  bodyHtml: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});

export const ArtifactRecordSchema = Schema.Struct({
  id: Schema.String,
  workItemId: Schema.String,
  taskRunId: Schema.optional(Schema.NullOr(Schema.String)),
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  producerType: Schema.String,
  producerId: Schema.optional(Schema.NullOr(Schema.String)),
  artifactType: Schema.String,
  artifactRole: Schema.String,
  title: Schema.optional(Schema.NullOr(Schema.String)),
  summary: Schema.optional(Schema.NullOr(Schema.String)),
  content: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  isCurrent: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(
    Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  ),
  createdAt: Schema.optional(Schema.String),
});

export const GetWorkItemResultSchema = Schema.NullOr(
  Schema.Struct({
    workItem: WorkItemRecordSchema,
    currentArtifacts: Schema.Array(ArtifactRecordSchema),
    childCount: Schema.Number,
  }),
);
