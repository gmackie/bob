// Wire schemas for Repository, Worktree, WorktreePlan, and
// WorktreePlanTask — supporting the project.repository RPCs
// added in Phase 7B-4B Task 6.
//
// Translated from Bob's Zod schemas in:
//   - packages/bob/src/api/src/router/repository.ts
//   - packages/bob/src/projects/src/schema.ts
//
// Enum values are the contract-level superset of Bob's DB enums
// (`planStatusEnum` from `@bob/projects/schema`).
//
// UUID fields use plain `Schema.String` on the wire (matching
// auth/projects/agent-instance convention).
import { Schema } from "effect";

// --- Enums ------------------------------------------------------------------

/** Plan lifecycle status (matches Bob's planStatusEnum). */
export const PlanStatusEnum = Schema.Literals([
  "draft",
  "active",
  "completed",
  "archived",
]);
export type PlanStatus = Schema.Schema.Type<typeof PlanStatusEnum>;

/** Task status within a worktree plan. */
export const PlanTaskStatusEnum = Schema.Literals([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
export type PlanTaskStatus = Schema.Schema.Type<typeof PlanTaskStatusEnum>;

// --- Record schemas ---------------------------------------------------------

/** A repository record. */
export const RepositorySchema = Schema.Struct({
  id: Schema.String, // UUID
  userId: Schema.String,
  planningProjectId: Schema.NullOr(Schema.String),
  name: Schema.String,
  path: Schema.String,
  branch: Schema.String,
  mainBranch: Schema.String,
  remoteUrl: Schema.NullOr(Schema.String),
  remoteProvider: Schema.NullOr(Schema.String),
  remoteOwner: Schema.NullOr(Schema.String),
  remoteName: Schema.NullOr(Schema.String),
  remoteInstanceUrl: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.NullOr(Schema.String),
});
export type RepositoryWire = Schema.Schema.Type<typeof RepositorySchema>;

/** A worktree record. */
export const WorktreeSchema = Schema.Struct({
  id: Schema.String, // UUID
  userId: Schema.String,
  repositoryId: Schema.String, // UUID
  path: Schema.String,
  branch: Schema.String,
  preferredAgent: Schema.String,
  isMainWorktree: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.NullOr(Schema.String),
});
export type WorktreeWire = Schema.Schema.Type<typeof WorktreeSchema>;

/** A task within a worktree plan (used by createWorktree + updateWorktreePlanning). */
export const WorktreePlanTaskSchema = Schema.Struct({
  key: Schema.String,
  content: Schema.String,
  status: Schema.optional(PlanTaskStatusEnum),
});
export type WorktreePlanTaskWire = Schema.Schema.Type<typeof WorktreePlanTaskSchema>;

/** A worktree plan record (from the `worktree_plans` table). */
export const WorktreePlanSchema = Schema.Struct({
  id: Schema.String, // UUID
  worktreeId: Schema.String, // UUID
  userId: Schema.String,
  filePath: Schema.String,
  title: Schema.NullOr(Schema.String),
  goal: Schema.NullOr(Schema.String),
  status: Schema.String,
  planningTaskId: Schema.NullOr(Schema.String),
  lastSyncedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.NullOr(Schema.String),
});
export type WorktreePlanWire = Schema.Schema.Type<typeof WorktreePlanSchema>;
