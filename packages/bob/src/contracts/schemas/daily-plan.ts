// Effect Schema definitions for the daily plan: what Bob intends to do today,
// approved by a person, closed with what actually happened.
import { Schema } from "effect";

export const DailyPlanStatusEnum = Schema.Literals(["draft", "approved", "closed"]);

export const DailyPlanItemSourceEnum = Schema.Literals(["queue", "bizpulse", "carryover"]);

export const DailyPlanItemSchema = Schema.Struct({
  workItemId: Schema.String,
  title: Schema.String,
  identifier: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  projectName: Schema.NullOr(Schema.String),
  objective: Schema.String,
  source: DailyPlanItemSourceEnum,
  statusAtPlan: Schema.String,
  order: Schema.Number,
  /** Joined at read time: where the item stands now. */
  currentStatus: Schema.optional(Schema.NullOr(Schema.String)),
});

export const DailyPlanIntakeSchema = Schema.Struct({
  provider: Schema.String,
  pulled: Schema.Number,
  created: Schema.Number,
  reused: Schema.Number,
  skipped: Schema.Number,
  error: Schema.NullOr(Schema.String),
});

export const DailyPlanReviewOutcomeEnum = Schema.Literals([
  "done",
  "in_review",
  "running",
  "blocked",
  "failed",
  "not_started",
  "other",
]);

export const DailyPlanReviewItemSchema = Schema.Struct({
  workItemId: Schema.String,
  title: Schema.String,
  identifier: Schema.NullOr(Schema.String),
  outcome: DailyPlanReviewOutcomeEnum,
  status: Schema.String,
  sessionIds: Schema.Array(Schema.String),
});

export const DailyPlanReviewSchema = Schema.Struct({
  items: Schema.Array(DailyPlanReviewItemSchema),
  counts: Schema.Record(Schema.String, Schema.Number),
  unplannedSessionIds: Schema.Array(Schema.String),
  sessionsCompleted: Schema.Number,
  sessionsFailed: Schema.Number,
  sessionsBlocked: Schema.Number,
  generatedAt: Schema.String,
});

export const DailyPlanRecordSchema = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  planDate: Schema.String,
  status: DailyPlanStatusEnum,
  summary: Schema.String,
  items: Schema.Array(DailyPlanItemSchema),
  intake: Schema.Array(DailyPlanIntakeSchema),
  review: Schema.NullOr(DailyPlanReviewSchema),
  reviewSummary: Schema.NullOr(Schema.String),
  capacity: Schema.Number,
  createdAt: Schema.String,
  approvedAt: Schema.NullOr(Schema.String),
  approvedByUserId: Schema.NullOr(Schema.String),
  closedAt: Schema.NullOr(Schema.String),
});
export type DailyPlanRecordWire = Schema.Schema.Type<typeof DailyPlanRecordSchema>;
