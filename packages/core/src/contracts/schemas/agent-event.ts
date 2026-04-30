// Agent Event schemas — wire-format contracts for Bob's event router.
//
// Mirrors the 5 procedures from
// `packages/bob/src/api/src/router/event.ts`.
//
// Enum values are the contract-level superset of Bob's DB enum
// (`eventTypeEnum` from `@bob/notifications/schema`).
//
// UUID fields use plain `Schema.String` on the wire (matching
// auth/projects/agent-run convention).

import { Schema } from "effect";

// --- Enums ------------------------------------------------------------------

/** Event type (matches Bob's eventTypeEnum). */
export const EventTypeEnum = Schema.Literal(
  "instance.started",
  "instance.stopped",
  "instance.error",
  "git.commit",
  "git.push",
  "git.pull",
  "git.checkout",
  "file.created",
  "file.modified",
  "file.deleted",
  "plan.created",
  "plan.updated",
  "plan.task_completed",
  "chat.message",
  "chat.tool_call",
  "chat.tool_result",
  "worktree.created",
  "worktree.deleted",
  "link.created",
  "link.removed",
);
export type EventType = Schema.Schema.Type<typeof EventTypeEnum>;

// --- Record schemas ---------------------------------------------------------

/** An event log record. */
export const EventLogSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  worktreeId: Schema.NullOr(Schema.String),
  repositoryId: Schema.NullOr(Schema.String),
  eventType: Schema.String,
  payload: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.String,
});
export type EventLogWire = Schema.Schema.Type<typeof EventLogSchema>;

/** Aggregated event statistics. */
export const EventStatsSchema = Schema.Struct({
  total: Schema.Number,
  byType: Schema.Record(Schema.String, Schema.Number),
});
export type EventStatsWire = Schema.Schema.Type<typeof EventStatsSchema>;
