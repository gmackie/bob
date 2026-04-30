// Wire schemas for PullRequest and PRReview — supporting the
// projects.pullRequest RPCs added in Phase 7B-4B Task 7.
//
// Translated from Bob's Zod schemas in:
//   - packages/bob/src/api/src/router/pullRequest.ts
//
// Enum values are the contract-level superset of Bob's DB enums.
// UUID fields use plain `Schema.String` on the wire (matching
// auth/projects/agent-instance convention).
import { Schema } from "effect";

// --- Enums ------------------------------------------------------------------

/** Pull request lifecycle status. */
export const PRStatusEnum = Schema.Literal("draft", "open", "merged", "closed");
export type PRStatus = Schema.Schema.Type<typeof PRStatusEnum>;

/** Merge method for pull requests. */
export const MergeMethodEnum = Schema.Literal("merge", "squash", "rebase");
export type MergeMethod = Schema.Schema.Type<typeof MergeMethodEnum>;

/** Review status for a PR review. */
export const ReviewStatusEnum = Schema.Literal(
  "approved",
  "changes_requested",
  "commented",
);
export type ReviewStatus = Schema.Schema.Type<typeof ReviewStatusEnum>;

// --- Record schemas ---------------------------------------------------------

/** A pull request record. */
export const PullRequestSchema = Schema.Struct({
  id: Schema.String, // UUID
  userId: Schema.String,
  repositoryId: Schema.NullOr(Schema.String),
  sessionId: Schema.NullOr(Schema.String),
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  headBranch: Schema.String,
  baseBranch: Schema.String,
  status: PRStatusEnum,
  remoteNumber: Schema.NullOr(Schema.Number),
  remoteUrl: Schema.NullOr(Schema.String),
  mergedAt: Schema.NullOr(Schema.String),
  planningTaskId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.NullOr(Schema.String),
});
export type PullRequestWire = Schema.Schema.Type<typeof PullRequestSchema>;

/** A PR review record (with optional reviewer info). */
export const PRReviewSchema = Schema.Struct({
  id: Schema.String, // UUID
  pullRequestId: Schema.String,
  userId: Schema.String,
  status: ReviewStatusEnum,
  body: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  userName: Schema.NullOr(Schema.String),
  userImage: Schema.NullOr(Schema.String),
});
export type PRReviewWire = Schema.Schema.Type<typeof PRReviewSchema>;
