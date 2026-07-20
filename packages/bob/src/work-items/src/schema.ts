// =============================================================================
// @bob/work-items/schema — Work-items area: tables, enums, relations,
// insert/zod schemas + the existing API contract zod schemas.
//
// Tables (verbatim moves from packages/bob/src/db/src/schema.ts in
// Phase 7B-2 Task 12):
//   - workItems
//   - planDrafts
//   - planDraftDependencies
//   - workItemDependencies
//   - dispatchBatches
//   - dispatchItems
//   - requirements
//   - planTaskItems
//   - taskRuns
//   - comments
//   - workItemArtifacts
//   - workItemSnapshots
//
// Enums colocated with the work-items area:
//   - workItemKind / WorkItemKind / workItemKindEnum
//   - workItemActivityType / WorkItemActivityType / workItemActivityTypeEnum
//   - workItemArtifactType / WorkItemArtifactType / workItemArtifactTypeEnum
//   - workItemNotificationType / WorkItemNotificationType /
//     workItemNotificationTypeEnum
//   - workItemArtifactProducerType (API-level — values diverge from the DB
//     pgEnum; see note below) + workItemArtifactProducerTypeEnum (DB pgEnum,
//     values inlined to avoid name collision)
//   - requirementCategory / RequirementCategory
//   - requirementStatus / RequirementStatus
//   - taskStatusEnum / TaskStatus
//   - taskRunStatusEnum / TaskRunStatus
//
// Cross-area FK references DROPPED in this move (re-add when target moves):
//   - planDrafts.sessionId → chatConversations.id (Task 14: chat)
//   - dispatchBatches.sessionId → chatConversations.id (Task 14: chat)
//   - taskRuns.sessionId → chatConversations.id (Task 14: chat)
//   - taskRuns.pullRequestId → pullRequests.id (Task 15: git) -- RE-ENABLED
//   - workItemArtifacts.sessionId → chatConversations.id (Task 14: chat)
// The columns themselves are preserved; only the runtime `.references()` link
// is removed. Postgres-side FKs are unchanged (driven by migrations).
//
// Cross-area RELATIONS commented out (re-add when target moves):
//   - planDraftsRelations.session → chatConversations (Task 14: chat)
//   - dispatchBatchesRelations.session → chatConversations (Task 14: chat)
//   - taskRunsRelations.session → chatConversations (Task 14: chat)
//   - taskRunsRelations.pullRequest → pullRequests (Task 15: git) -- RE-ENABLED
//
// NOTE: The mutual dep (work-items → git for pullRequests, git → work-items
// for workItems/taskRuns) is safe because both are declaration-only — pgTable/
// relations are lazy, not runtime-evaluated (same pattern as agents ↔ chat).
//
// Note on workItemArtifactProducerType: the API contract zod enum
// ("task_run" | "session" | "integration" | "manual") and the DB pgEnum
// ("bob" | "forgegraph" | "human" | "system") diverge. This predates the
// Task-12 move (see comment in api/router/workItems.ts). The API-level const
// keeps its name; the DB pgEnum is constructed from an inline literal.
// =============================================================================

import { relations, sql } from "drizzle-orm";
import {  index, pgEnum, pgTable } from "drizzle-orm/pg-core";
import type {AnyPgColumn} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { user } from "@bob/auth/schema";
import { pullRequests } from "@bob/git/schema";
import { projects, repositories, worktreePlans, worktrees } from "@bob/projects/schema";
import { workspaces } from "@bob/tenancy/schema";

// -----------------------------------------------------------------------------
// API contract zod helpers (existing — unchanged)
// -----------------------------------------------------------------------------

const dateTimeStringSchema = z.string().datetime();
const metadataSchema = z.record(z.string(), z.unknown()).nullable().optional();

// -----------------------------------------------------------------------------
// API contract enums (existing — unchanged)
//
// `workItemArtifactType` and `workItemNotificationType` happen to match the
// DB pgEnum value sets exactly, so a single declaration serves both.
// `workItemArtifactProducerType` (API) diverges from the DB pgEnum; the DB
// values are inlined into the pgEnum below.
// -----------------------------------------------------------------------------

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
export type WorkItemArtifactType = (typeof workItemArtifactType)[number];
export const workItemArtifactTypeEnum = pgEnum(
  "work_item_artifact_type",
  workItemArtifactType,
);

export const workItemNotificationType = [
  "work_item_assigned",
  "work_item_commented",
  "work_item_needs_input",
  "work_item_review_ready",
  "task_completed",
  "batch_completed",
] as const;
export type WorkItemNotificationType =
  (typeof workItemNotificationType)[number];
export const workItemNotificationTypeEnum = pgEnum(
  "work_item_notification_type",
  workItemNotificationType,
);

// DB-only pgEnum for workItemArtifactProducerType (values differ from API).
export type WorkItemArtifactProducerType =
  | "bob"
  | "forgegraph"
  | "human"
  | "system";
export const workItemArtifactProducerTypeEnum = pgEnum(
  "work_item_artifact_producer_type",
  ["bob", "forgegraph", "human", "system"] as const,
);

// -----------------------------------------------------------------------------
// Work-item core enums (DB-level)
// -----------------------------------------------------------------------------

export const workItemKind = ["issue", "epic", "task"] as const;
export type WorkItemKind = (typeof workItemKind)[number];
export const workItemKindEnum = pgEnum("work_item_kind", workItemKind);

export const workItemActivityType = [
  "comment_added",
  "status_changed",
  "artifact_added",
  "notification_created",
  "build_status_changed",
  "deploy_status_changed",
  "planning_session_completed",
  "review_requested",
  "review_approved",
  "review_changes_requested",
] as const;
export type WorkItemActivityType = (typeof workItemActivityType)[number];
export const workItemActivityTypeEnum = pgEnum(
  "work_item_activity_type",
  workItemActivityType,
);

// -----------------------------------------------------------------------------
// Requirements / task / task-run enums
// -----------------------------------------------------------------------------

export const requirementCategory = [
  "data",
  "api",
  "ui",
  "infra",
  "test",
  "other",
] as const;
export type RequirementCategory = (typeof requirementCategory)[number];

export const requirementStatus = [
  "pending",
  "in_progress",
  "done",
] as const;
export type RequirementStatus = (typeof requirementStatus)[number];

export const taskStatusEnum = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type TaskStatus = (typeof taskStatusEnum)[number];

export const taskRunStatusEnum = [
  "starting",
  "running",
  "blocked",
  "completed",
  "failed",
] as const;
export type TaskRunStatus = (typeof taskRunStatusEnum)[number];

// -----------------------------------------------------------------------------
// API contract zod schemas (existing — unchanged)
// -----------------------------------------------------------------------------

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
    agentTypeOverride: z.string().nullable().optional(),
    queueSortOrder: z.number().int().optional(),
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
  // Multi-status filter. When present, takes precedence over `status`. Lets a
  // lane (e.g. the priority queue: backlog/todo/ready/draft) fetch only its own
  // statuses instead of slicing a recency-capped firehose of every item — the
  // bug where a workspace full of `in_review` items starved the backlog out of
  // the first 100 rows and every "what's next" view read 0.
  statuses: z.array(z.string()).optional(),
  limit: z.number().min(1).max(100).default(50),
});

// Per-status counts for a workspace's work items. Cheap GROUP BY that is immune
// to the list cap, so lane cards / sidebar badges can show accurate totals
// (e.g. 329 in_review, 25 backlog) without fetching every row.
export const workItemStatusCountsInputSchema = z.object({
  workspaceId: z.string().uuid(),
  kind: z.enum(["issue", "epic", "task"]).optional(),
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
    priority: z.string().min(1).max(128).optional(),
    // null clears the override (inherit project/workspace default).
    agentTypeOverride: z.string().max(50).nullable().optional(),
  })
  .refine(
    (input) =>
      input.title !== undefined ||
      input.description !== undefined ||
      input.status !== undefined ||
      input.priority !== undefined ||
      input.agentTypeOverride !== undefined,
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

export const markAllNotificationsAsReadInputSchema = z.object({});

export const markAllNotificationsAsReadOutputSchema = z.object({
  count: z.number().int().nonnegative(),
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
export type MarkAllNotificationsAsReadInput = z.infer<
  typeof markAllNotificationsAsReadInputSchema
>;
export type MarkAllNotificationsAsReadResult = z.infer<
  typeof markAllNotificationsAsReadOutputSchema
>;

// =============================================================================
// Drizzle tables
// =============================================================================

export const workItems = pgTable("work_items", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  parentId: t.uuid(),
  ownerUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  assigneeUserId: t.text(),
  workspaceId: t.uuid(),
  projectId: t.uuid(),
  sequenceNumber: t.integer().notNull().default(0),
  queueSortOrder: t.integer().notNull().default(0),
  kind: workItemKindEnum().notNull(),
  title: t.varchar({ length: 256 }).notNull(),
  description: t.text(),
  status: t.varchar({ length: 40 }).notNull().default("draft"),
  // Per-work-item agent override; top of the resolveAgentType hierarchy.
  // Nullable = inherit from project / workspace default.
  agentTypeOverride: t.varchar({ length: 50 }),
  externalId: t.text(),
  externalProvider: t.varchar({ length: 20 }),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreateWorkItemSchema = createInsertSchema(workItems, {
  kind: z.enum(workItemKind),
  title: z.string().max(256),
  status: z.string().max(40).default("draft"),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const planDrafts = pgTable(
  "plan_drafts",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    // sessionId FK to chatConversations.id dropped; re-enable in Task 14 (chat).
    sessionId: t.uuid().notNull(),
    workspaceId: t.uuid().notNull(),
    projectId: t.uuid().notNull(),
    title: t.varchar({ length: 256 }).notNull(),
    description: t.text(),
    kind: workItemKindEnum().notNull().default("task"),
    priority: t.varchar({ length: 20 }).notNull().default("no_priority"),
    sortOrder: t.integer().notNull().default(0),
    status: t.varchar({ length: 20 }).notNull().default("draft"),
    // status: "draft" | "committed" | "discarded"
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "string", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "plan_drafts_session_idx", columns: [table.sessionId] },
  ],
);

export const planDraftDependencies = pgTable(
  "plan_draft_dependencies",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    draftId: t
      .uuid()
      .notNull()
      .references(() => planDrafts.id, { onDelete: "cascade" }),
    dependsOnDraftId: t
      .uuid()
      .notNull()
      .references(() => planDrafts.id, { onDelete: "cascade" }),
  }),
  (table) => [
    {
      name: "plan_draft_deps_unique_idx",
      columns: [table.draftId, table.dependsOnDraftId],
      unique: true,
    },
  ],
);

export const workItemDependencies = pgTable(
  "work_item_dependencies",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workItemId: t
      .uuid()
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    dependsOnWorkItemId: t
      .uuid()
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    {
      name: "work_item_deps_unique_idx",
      columns: [table.workItemId, table.dependsOnWorkItemId],
      unique: true,
    },
  ],
);

// =============================================================================
// Dispatch Tables (batch execution of planning tasks)
// =============================================================================

export const dispatchBatches = pgTable("dispatch_batches", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  // sessionId FK to chatConversations.id dropped; re-enable in Task 14 (chat).
  sessionId: t.uuid(),
  workspaceId: t.text().notNull(),
  projectId: t.text().notNull(),
  status: t.varchar({ length: 20 }).notNull().default("pending"),
  // status: "pending" | "dispatching" | "running" | "completed" | "failed"
  concurrency: t.integer().notNull().default(2),
  totalTasks: t.integer().notNull().default(0),
  completedTasks: t.integer().notNull().default(0),
  failedTasks: t.integer().notNull().default(0),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t.timestamp({ mode: "string", withTimezone: true }).$onUpdateFn(() => sql`now()`),
}));

export const dispatchItems = pgTable(
  "dispatch_items",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    batchId: t.uuid().notNull().references(() => dispatchBatches.id, { onDelete: "cascade" }),
    planningTaskId: t.text().notNull(),
    planningTaskIdentifier: t.text().notNull(),
    title: t.text().notNull(),
    description: t.text(),
    agentType: t.varchar({ length: 50 }).notNull().default("opencode"),
    status: t.varchar({ length: 20 }).notNull().default("queued"),
    // status: "queued" | "blocked" | "running" | "completed" | "failed"
    blockedByItems: t.json().$type<string[]>().default([]),
    // Array of dispatchItem IDs that must complete before this one starts
    taskRunId: t.uuid().references(() => taskRuns.id, { onDelete: "set null" }),
    sortOrder: t.integer().notNull().default(0),
    pipelineState: t.varchar({ length: 30 }),
    planningProvider: t.varchar({ length: 20 }).notNull().default("internal"),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "string", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "dispatch_items_batch_idx", columns: [table.batchId] },
  ],
);

// =============================================================================
// Requirements
// =============================================================================

export const requirements = pgTable("requirements", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workItemId: t
    .uuid()
    .notNull()
    .references(() => workItems.id, { onDelete: "cascade" }),
  category: t
    .text({ enum: requirementCategory })
    .notNull()
    .default("other"),
  description: t.text().notNull(),
  status: t
    .text({ enum: requirementStatus })
    .notNull()
    .default("pending"),
  linkedTaskId: t.uuid(),
  sortOrder: t.integer().notNull().default(0),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}), (table) => [
  index("requirements_work_item_id_idx").on(table.workItemId),
]);

// =============================================================================
// Plan task items (worktree-plan-scoped tasks)
// =============================================================================

export const planTaskItems = pgTable("plan_task_items", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  planId: t
    .uuid()
    .notNull()
    .references(() => worktreePlans.id, { onDelete: "cascade" }),
  taskKey: t.varchar({ length: 20 }).notNull(),
  content: t.text().notNull(),
  status: t.varchar({ length: 20 }).notNull().default("pending"),
  priority: t.varchar({ length: 10 }).notNull().default("medium"),
  parentTaskKey: t.varchar({ length: 20 }),
  sortOrder: t.integer().notNull().default(0),
  completedAt: t.timestamp({ mode: "string", withTimezone: true }),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreatePlanTaskItemSchema = createInsertSchema(planTaskItems, {
  taskKey: z.string().max(20),
  content: z.string(),
  status: z.enum(taskStatusEnum).default("pending"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  parentTaskKey: z.string().max(20).optional(),
  sortOrder: z.number().int().default(0),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

// =============================================================================
// Task Runs (planning execution tracking)
// =============================================================================

export const taskRuns = pgTable("task_runs", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  planningWorkspaceId: t.text("kanbanger_workspace_id").notNull(),
  planningItemId: t.text("kanbanger_issue_id").notNull(),
  planningItemIdentifier: t.text("kanbanger_issue_identifier").notNull(), // e.g., "PROJ-123"
  workItemId: t.uuid().references(() => workItems.id, { onDelete: "set null" }),
  workItemIdentifierSnapshot: t.text(),
  // sessionId FK to chatConversations.id dropped; re-enable in Task 14 (chat).
  sessionId: t.uuid(),
  repositoryId: t
    .uuid()
    .references(() => repositories.id, { onDelete: "set null" }),
  worktreeId: t.uuid().references(() => worktrees.id, { onDelete: "set null" }),
  pullRequestId: t.uuid().references(() => pullRequests.id, { onDelete: "set null" }),
  status: t.varchar({ length: 20 }).notNull(), // 'starting' | 'running' | 'blocked' | 'completed' | 'failed'
  blockedReason: t.text(),
  branch: t.text(), // The git branch created for this task run
  forgegraphRevisionId: t.text(), // VCS revision ID (commit SHA or jj change ID) for ForgeGraph tracking
  parentTaskRunId: t.uuid().references((): AnyPgColumn => taskRuns.id, { onDelete: "set null" }),
  runPhase: t.varchar({ length: 20 }).notNull().default("execute"),
  // runPhase values: "shape" | "plan" | "execute" | "review" | "ship"
  planningProvider: t.varchar({ length: 20 }).notNull().default("internal"),
  syncFailures: t.jsonb().$type<{ method: string; error: string; timestamp: string }[]>(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
  completedAt: t.timestamp({ mode: "string", withTimezone: true }),
}));

export const CreateTaskRunSchema = createInsertSchema(taskRuns, {
  planningWorkspaceId: z.string(),
  planningItemId: z.string(),
  planningItemIdentifier: z.string(),
  workItemIdentifierSnapshot: z.string().optional(),
  status: z.enum(taskRunStatusEnum),
  blockedReason: z.string().optional(),
  branch: z.string().optional(),
  planningProvider: z.string().max(20).default("internal"),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

// =============================================================================
// Comments
// =============================================================================

export const comments = pgTable("comments", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workItemId: t
    .uuid()
    .notNull()
    .references(() => workItems.id, { onDelete: "cascade" }),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  parentId: t.uuid(),
  body: t.text().notNull(),
  bodyHtml: t.text(),
  edited: t.boolean().notNull().default(false),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreateCommentSchema = createInsertSchema(comments, {
  body: z.string().min(1).max(10000),
  bodyHtml: z.string().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// =============================================================================
// Work Item Artifacts
// =============================================================================

export const workItemArtifacts = pgTable("work_item_artifacts", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workItemId: t
    .uuid()
    .notNull()
    .references(() => workItems.id, { onDelete: "cascade" }),
  taskRunId: t.uuid().references(() => taskRuns.id, { onDelete: "set null" }),
  producerType: workItemArtifactProducerTypeEnum().notNull(),
  producerId: t.text(),
  artifactType: workItemArtifactTypeEnum().notNull(),
  artifactRole: t.text().notNull(),
  url: t.text(),
  title: t.text(),
  summary: t.text(),
  content: t.text(),
  // sessionId FK to chatConversations.id dropped; re-enable in Task 14 (chat).
  sessionId: t.uuid(),
  metadata: t.json().$type<Record<string, unknown>>(),
  isCurrent: t.boolean().notNull().default(true),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

export const CreateWorkItemArtifactSchema = createInsertSchema(
  workItemArtifacts,
  {
    producerType: z.enum(["bob", "forgegraph", "human", "system"] as const),
    artifactType: z.enum(workItemArtifactType),
    artifactRole: z.string().min(1),
    url: z.string().url().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    content: z.string().optional(),
  },
).omit({
  id: true,
  createdAt: true,
});

// =============================================================================
// Work-item time-travel snapshots
// =============================================================================

export const workItemSnapshots = pgTable(
  "work_item_snapshots",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workItemId: t
      .uuid()
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    stage: t.text().notNull(),
    data: t.jsonb().notNull().default({}),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [index("work_item_snapshots_work_item_id_idx").on(table.workItemId)],
);

// =============================================================================
// Relations
// =============================================================================

export const workItemsRelations = relations(workItems, ({ one, many }) => ({
  ownerUser: one(user, {
    fields: [workItems.ownerUserId],
    references: [user.id],
  }),
  assigneeUser: one(user, {
    fields: [workItems.assigneeUserId],
    references: [user.id],
  }),
  workspace: one(workspaces, {
    fields: [workItems.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [workItems.projectId],
    references: [projects.id],
  }),
  parent: one(workItems, {
    fields: [workItems.parentId],
    references: [workItems.id],
    relationName: "work_item_parent",
  }),
  children: many(workItems, {
    relationName: "work_item_parent",
  }),
  requirements: many(requirements, {
    relationName: "work_item_requirements",
  }),
  dependencies: many(workItemDependencies, {
    relationName: "work_item_dependencies",
  }),
  dependedOnBy: many(workItemDependencies, {
    relationName: "work_item_depended_on_by",
  }),
}));

export const planDraftsRelations = relations(planDrafts, ({ many }) => ({
  // TODO Phase 7B-2 Task 14: re-enable session → chatConversations when chat moves.
  // session: one(chatConversations, {
  //   fields: [planDrafts.sessionId],
  //   references: [chatConversations.id],
  // }),
  dependencies: many(planDraftDependencies, { relationName: "draft" }),
  dependedOnBy: many(planDraftDependencies, { relationName: "dependsOn" }),
}));

export const planDraftDependenciesRelations = relations(
  planDraftDependencies,
  ({ one }) => ({
    draft: one(planDrafts, {
      fields: [planDraftDependencies.draftId],
      references: [planDrafts.id],
      relationName: "draft",
    }),
    dependsOn: one(planDrafts, {
      fields: [planDraftDependencies.dependsOnDraftId],
      references: [planDrafts.id],
      relationName: "dependsOn",
    }),
  }),
);

export const workItemDependenciesRelations = relations(
  workItemDependencies,
  ({ one }) => ({
    workItem: one(workItems, {
      fields: [workItemDependencies.workItemId],
      references: [workItems.id],
      relationName: "work_item_dependencies",
    }),
    dependsOn: one(workItems, {
      fields: [workItemDependencies.dependsOnWorkItemId],
      references: [workItems.id],
      relationName: "work_item_depended_on_by",
    }),
  }),
);

export const dispatchBatchesRelations = relations(
  dispatchBatches,
  ({ one, many }) => ({
    user: one(user, {
      fields: [dispatchBatches.userId],
      references: [user.id],
    }),
    // TODO Phase 7B-2 Task 14: re-enable session → chatConversations when chat moves.
    // session: one(chatConversations, {
    //   fields: [dispatchBatches.sessionId],
    //   references: [chatConversations.id],
    // }),
    items: many(dispatchItems),
  }),
);

export const dispatchItemsRelations = relations(
  dispatchItems,
  ({ one }) => ({
    batch: one(dispatchBatches, {
      fields: [dispatchItems.batchId],
      references: [dispatchBatches.id],
    }),
    taskRun: one(taskRuns, {
      fields: [dispatchItems.taskRunId],
      references: [taskRuns.id],
    }),
  }),
);

export const requirementsRelations = relations(
  requirements,
  ({ one }) => ({
    workItem: one(workItems, {
      fields: [requirements.workItemId],
      references: [workItems.id],
      relationName: "work_item_requirements",
    }),
    linkedTask: one(workItems, {
      fields: [requirements.linkedTaskId],
      references: [workItems.id],
      relationName: "requirement_linked_task",
    }),
  }),
);

export const planTaskItemsRelations = relations(planTaskItems, ({ one }) => ({
  plan: one(worktreePlans, {
    fields: [planTaskItems.planId],
    references: [worktreePlans.id],
  }),
}));

export const taskRunsRelations = relations(taskRuns, ({ one, many }) => ({
  user: one(user, {
    fields: [taskRuns.userId],
    references: [user.id],
  }),
  // TODO Phase 7B-2 Task 14: re-enable session → chatConversations when chat moves.
  // session: one(chatConversations, {
  //   fields: [taskRuns.sessionId],
  //   references: [chatConversations.id],
  // }),
  workItem: one(workItems, {
    fields: [taskRuns.workItemId],
    references: [workItems.id],
  }),
  repository: one(repositories, {
    fields: [taskRuns.repositoryId],
    references: [repositories.id],
  }),
  worktree: one(worktrees, {
    fields: [taskRuns.worktreeId],
    references: [worktrees.id],
  }),
  pullRequest: one(pullRequests, {
    fields: [taskRuns.pullRequestId],
    references: [pullRequests.id],
  }),
  parentRun: one(taskRuns, {
    fields: [taskRuns.parentTaskRunId],
    references: [taskRuns.id],
    relationName: "task_run_parent",
  }),
  childRuns: many(taskRuns, {
    relationName: "task_run_parent",
  }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  workItem: one(workItems, {
    fields: [comments.workItemId],
    references: [workItems.id],
  }),
  user: one(user, {
    fields: [comments.userId],
    references: [user.id],
  }),
}));

export const workItemArtifactsRelations = relations(
  workItemArtifacts,
  ({ one }) => ({
    workItem: one(workItems, {
      fields: [workItemArtifacts.workItemId],
      references: [workItems.id],
    }),
    taskRun: one(taskRuns, {
      fields: [workItemArtifacts.taskRunId],
      references: [taskRuns.id],
    }),
  }),
);

export const workItemSnapshotsRelations = relations(
  workItemSnapshots,
  ({ one }) => ({
    workItem: one(workItems, {
      fields: [workItemSnapshots.workItemId],
      references: [workItems.id],
    }),
  }),
);
