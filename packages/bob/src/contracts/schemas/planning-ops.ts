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

// =============================================================================
// Skill schemas (skill.ts) — Task 7
// =============================================================================

/** Category enum for skill templates. */
export const SkillCategoryEnum = Schema.Literals([
  "planning",
  "execution",
  "review",
  "deploy",
  "ops",
  "other",
]);

/** Source enum for skill templates. */
export const SkillSourceEnum = Schema.Literals([
  "builtin",
  "gstack",
  "custom",
]);

/** Execution status enum for skill executions. */
export const ExecutionStatusEnum = Schema.Literals([
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/** Skill template record (skills table). */
export const SkillRecordSchema = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  category: Schema.String,
  source: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});

/** Skill execution record (skill_executions table). */
export const SkillExecutionRecordSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  skillId: Schema.optional(Schema.NullOr(Schema.String)),
  skillSlug: Schema.String,
  workItemId: Schema.optional(Schema.NullOr(Schema.String)),
  parentExecutionId: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.String,
  input: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  output: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  findings: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
  startedAt: Schema.optional(Schema.String),
  completedAt: Schema.optional(Schema.NullOr(Schema.String)),
  durationMs: Schema.optional(Schema.NullOr(Schema.Number)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
  // Joined fields from list/get
  skillName: Schema.optional(Schema.NullOr(Schema.String)),
  parentExecution: Schema.optional(Schema.NullOr(Schema.Unknown)),
});

/** Seed result for skill.seed. */
export const SkillSeedResultSchema = Schema.Struct({
  seeded: Schema.Number,
  total: Schema.Number,
});

// =============================================================================
// Snapshot schemas (snapshot.ts) — Task 7
// =============================================================================

/** Work item snapshot record (work_item_snapshots table). */
export const WorkItemSnapshotRecordSchema = Schema.Struct({
  id: Schema.String,
  workItemId: Schema.String,
  stage: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.optional(Schema.String),
});

// =============================================================================
// Checkpoint schemas (checkpoint.ts) — Task 7
// =============================================================================

/** Session checkpoint record (session_checkpoints table). */
export const CheckpointRecordSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  turnNumber: Schema.Number,
  eventSeq: Schema.Number,
  label: Schema.optional(Schema.NullOr(Schema.String)),
  snapshotData: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  gitRef: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
});

/** Result of branchFrom: a new session record. */
export const BranchFromResultSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  repositoryId: Schema.optional(Schema.NullOr(Schema.String)),
  worktreeId: Schema.optional(Schema.NullOr(Schema.String)),
  workingDirectory: Schema.optional(Schema.NullOr(Schema.String)),
  title: Schema.optional(Schema.NullOr(Schema.String)),
  sessionType: Schema.optional(Schema.NullOr(Schema.String)),
  workItemId: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.optional(Schema.String),
});
