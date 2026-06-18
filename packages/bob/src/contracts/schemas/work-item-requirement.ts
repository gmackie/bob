// Effect Schema definitions for Bob work-item requirement sub-namespace.
// Translated from Zod schemas in packages/bob/src/work-items/src/schema.ts.
// 7B-4C Task 3.
import { Schema } from "effect";

export const RequirementCategoryEnum = Schema.Literals([
  "data",
  "api",
  "ui",
  "infra",
  "test",
  "other",
]);

export const RequirementStatusEnum = Schema.Literals([
  "pending",
  "in_progress",
  "done",
]);

export const RequirementRecordSchema = Schema.Struct({
  id: Schema.String,
  workItemId: Schema.String,
  category: Schema.String,
  description: Schema.String,
  status: Schema.String,
  linkedTaskId: Schema.optional(Schema.NullOr(Schema.String)),
  sortOrder: Schema.Number,
  createdAt: Schema.optional(Schema.String),
});
