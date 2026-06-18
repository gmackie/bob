import { Schema } from "effect";

export const ExplorationStatus = Schema.Literals([
  "running",
  "paused",
  "completed",
  "awaiting_input",
]);
export type ExplorationStatus = typeof ExplorationStatus.Type;

export const ExplorationDirection = Schema.Literals([
  "continue",
  "go_deeper",
  "redirect",
  "stop",
]);
export type ExplorationDirection = typeof ExplorationDirection.Type;

export const ExplorationCheckIn = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  explorationId: Schema.String.check(Schema.isUUID()),
  summary: Schema.String,
  suggestedDirections: Schema.Array(Schema.String),
  articlesWritten: Schema.Array(Schema.String),
  depth: Schema.Number,
  status: ExplorationStatus,
});
export type ExplorationCheckIn = typeof ExplorationCheckIn.Type;

export const StartExplorationInput = Schema.Struct({
  threadId: Schema.String.check(Schema.isUUID()),
  branchId: Schema.String.check(Schema.isUUID()),
  topic: Schema.String.check(Schema.isMinLength(1)),
  maxDepth: Schema.Number.pipe(Schema.withDecodingDefault(() => 5)),
});

export const RespondToCheckInInput = Schema.Struct({
  explorationId: Schema.String.check(Schema.isUUID()),
  checkInId: Schema.String.check(Schema.isUUID()),
  direction: ExplorationDirection,
  redirectTopic: Schema.optional(Schema.OptionFromUndefinedOr(Schema.String)),
});

export const ExplorationSummary = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  threadId: Schema.String.check(Schema.isUUID()),
  topic: Schema.String,
  status: ExplorationStatus,
  depth: Schema.Number,
  articlesWrittenCount: Schema.Number,
  lastCheckIn: Schema.optional(Schema.OptionFromUndefinedOr(ExplorationCheckIn)),
});
export type ExplorationSummary = typeof ExplorationSummary.Type;
