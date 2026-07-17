// Wire schemas for FeatureBranch and FeatureBranchTaskPR — supporting the
// projects.featureBranch RPCs added in Phase 7B-4B Task 7.
//
// Translated from Bob's Zod schemas in:
//   - packages/bob/src/api/src/router/featureBranch.ts
//
// Enum values are the contract-level superset of Bob's DB enums.
// UUID fields use plain `Schema.String` on the wire (matching
// auth/projects/agent-instance convention).
import { Schema } from "effect";

import { PullRequestSchema } from "./project-pull-request.js";

// --- Enums ------------------------------------------------------------------

/** Feature branch lifecycle status. */
export const FeatureBranchStatusEnum = Schema.Literals([
  "active",
  "ready",
  "merged",
  "abandoned",
]);
export type FeatureBranchStatus = Schema.Schema.Type<
  typeof FeatureBranchStatusEnum
>;

// --- Record schemas ---------------------------------------------------------

/** A task-PR link within a feature branch. */
export const FeatureBranchTaskPRSchema = Schema.Struct({
  id: Schema.String, // UUID
  featureBranchId: Schema.String,
  pullRequestId: Schema.String,
  mergedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  pullRequest: Schema.NullOr(PullRequestSchema),
});
export type FeatureBranchTaskPRWire = Schema.Schema.Type<
  typeof FeatureBranchTaskPRSchema
>;

/** A feature branch record. */
export const FeatureBranchSchema = Schema.Struct({
  id: Schema.String, // UUID
  workItemId: Schema.String,
  repositoryId: Schema.String,
  branchName: Schema.String,
  baseBranch: Schema.String,
  status: FeatureBranchStatusEnum,
  featurePrId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.NullOr(Schema.String),
});
export type FeatureBranchWire = Schema.Schema.Type<typeof FeatureBranchSchema>;

/** Feature branch with task-PR count (list endpoint response). */
export const FeatureBranchListItemSchema = Schema.Struct({
  id: Schema.String,
  workItemId: Schema.String,
  repositoryId: Schema.String,
  branchName: Schema.String,
  baseBranch: Schema.String,
  status: FeatureBranchStatusEnum,
  featurePrId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  taskPRCount: Schema.Number,
});
export type FeatureBranchListItemWire = Schema.Schema.Type<
  typeof FeatureBranchListItemSchema
>;

/** Feature branch with full taskPRs detail (get endpoint response). */
export const FeatureBranchDetailSchema = Schema.Struct({
  ...FeatureBranchSchema.fields,
  taskPRs: Schema.Array(FeatureBranchTaskPRSchema),
});
export type FeatureBranchDetailWire = Schema.Schema.Type<
  typeof FeatureBranchDetailSchema
>;
