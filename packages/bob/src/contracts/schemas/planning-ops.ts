// Effect Schema definitions for Bob plan (worktree plans + task items) and
// dispatch (batch execution) domain objects.
// Translated from tRPC routers in api/router/plan.ts and api/router/dispatch.ts.
// 7B-4C Task 6.
import { Schema } from "effect";

// =============================================================================
// Worktree Plan schemas (plan.ts)
// =============================================================================

/** Status enum for worktree plans. */
export const PlanStatusEnum = Schema.Literals([
  "draft",
  "active",
  "completed",
  "archived",
]);

/** Status enum for plan task items. */
export const PlanTaskStatusEnum = Schema.Literals([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

/** Priority enum for plan task items. */
export const PlanTaskPriorityEnum = Schema.Literals(["low", "medium", "high"]);

/** Worktree plan record (worktree_plans table). */
export const WorktreePlanRecordSchema = Schema.Struct({
  id: Schema.String,
  worktreeId: Schema.String,
  userId: Schema.String,
  filePath: Schema.String,
  title: Schema.optional(Schema.NullOr(Schema.String)),
  goal: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.String,
  planningTaskId: Schema.optional(Schema.NullOr(Schema.String)),
  lastSyncedAt: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

/** Plan task item record (plan_task_items table). */
export const PlanTaskItemRecordSchema = Schema.Struct({
  id: Schema.String,
  planId: Schema.String,
  taskKey: Schema.String,
  content: Schema.String,
  status: Schema.String,
  priority: Schema.String,
  parentTaskKey: Schema.optional(Schema.NullOr(Schema.String)),
  sortOrder: Schema.Number,
  completedAt: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

// =============================================================================
// Dispatch schemas (dispatch.ts)
// =============================================================================

/** Status enum for dispatch batches. */
export const DispatchBatchStatusEnum = Schema.Literals([
  "pending",
  "dispatching",
  "running",
  "completed",
  "failed",
]);

/** Status enum for dispatch items. */
export const DispatchItemStatusEnum = Schema.Literals([
  "queued",
  "blocked",
  "running",
  "completed",
  "failed",
]);

/** Dispatch batch record (dispatch_batches table). */
export const DispatchBatchRecordSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  workspaceId: Schema.String,
  projectId: Schema.String,
  status: Schema.String,
  concurrency: Schema.Number,
  totalTasks: Schema.Number,
  completedTasks: Schema.Number,
  failedTasks: Schema.Number,
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

/** Dispatch item record (dispatch_items table). */
export const DispatchItemRecordSchema = Schema.Struct({
  id: Schema.String,
  batchId: Schema.String,
  planningTaskId: Schema.String,
  planningTaskIdentifier: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  agentType: Schema.String,
  status: Schema.String,
  blockedByItems: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  taskRunId: Schema.optional(Schema.NullOr(Schema.String)),
  sortOrder: Schema.Number,
  pipelineState: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

// --- Composite result schemas ---

/** Result of createBatch / getBatch / checkProgress: batch + items. */
export const DispatchBatchWithItemsSchema = Schema.Struct({
  batch: DispatchBatchRecordSchema,
  items: Schema.Array(DispatchItemRecordSchema),
});

/** Result of dispatch mutation: count of started items. */
export const DispatchStartedResultSchema = Schema.Struct({
  started: Schema.Number,
});

/** Simple success result for mutations returning { success: true }. */
export const SuccessResultSchema = Schema.Struct({
  success: Schema.Boolean,
});
