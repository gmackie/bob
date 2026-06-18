// Wire schemas for Git operations — supporting the projects.git RPCs
// added in Phase 7B-4B Task 8.
//
// Translated from Bob's Zod schemas in:
//   - packages/bob/src/api/src/router/git.ts
//
// UUID fields use plain `Schema.String` on the wire (matching
// auth/projects/agent-instance convention).
import { Schema } from "effect";

import { PullRequestSchema } from "./project-pull-request.js";

// --- Record schemas ---------------------------------------------------------

/** Result of the pushAndCreatePr procedure. */
export const PushAndCreatePrResultSchema = Schema.Struct({
  pushed: Schema.Boolean,
  pullRequest: PullRequestSchema,
});
export type PushAndCreatePrResultWire = Schema.Schema.Type<
  typeof PushAndCreatePrResultSchema
>;

/** A Jujutsu commit record (from jj log). */
export const JjCommitSchema = Schema.Struct({
  changeId: Schema.String,
  commitId: Schema.String,
  description: Schema.String,
  author: Schema.String,
  timestamp: Schema.String,
  branches: Schema.Array(Schema.String),
  isWorkingCopy: Schema.Boolean,
});
export type JjCommitWire = Schema.Schema.Type<typeof JjCommitSchema>;

/** Result of a jj mutation (new, describe, squash). */
export const JjMutationResultSchema = Schema.Struct({
  success: Schema.Boolean,
  output: Schema.optional(Schema.String),
});
export type JjMutationResultWire = Schema.Schema.Type<
  typeof JjMutationResultSchema
>;

/** Result of jj diff. */
export const JjDiffResultSchema = Schema.Struct({
  diff: Schema.String,
});
export type JjDiffResultWire = Schema.Schema.Type<typeof JjDiffResultSchema>;
