// Effect Schema definitions for Bob worktree link sub-namespace.
// Translated from Drizzle table + Zod schemas in packages/bob/src/projects/src/schema.ts.
// 7B-4C Task 3.
import { Schema } from "effect";

export const LinkTypeEnum = Schema.Literals([
  "planning_task",
  "github_pr",
  "github_issue",
  "control_panel",
  "external",
]);

export const WorktreeLinkRecordSchema = Schema.Struct({
  id: Schema.String,
  worktreeId: Schema.String,
  userId: Schema.String,
  linkType: Schema.String,
  externalId: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  title: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(
    Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  ),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
});
