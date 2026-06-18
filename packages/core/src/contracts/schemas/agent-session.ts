// Agent Session schemas — wire-format contracts for Bob's session router.
//
// Mirrors the 28 procedures from
// `packages/bob/src/api/src/router/session.ts` (the largest router at 1196
// lines). Enum values are the contract-level superset; handler mapping
// bridges the DB values to the wire values in Phase D.
//
// UUID fields use plain `Schema.String` on the wire (matching
// auth/projects/agent-run convention).
//
// Enum types use `Schema.Literals(["a", "b", "c"])` which creates a union of
// literals (verified in Effect 4.0.0-beta.43).

import { Schema } from "effect";

// --- Enums ------------------------------------------------------------------

/** Session lifecycle status. */
export const SessionStatusEnum = Schema.Literals([
  "provisioning",
  "starting",
  "running",
  "idle",
  "stopping",
  "stopped",
  "error",
]);
export type SessionStatus = Schema.Schema.Type<typeof SessionStatusEnum>;

/** Direction of a session event relative to the session. */
export const EventDirectionEnum = Schema.Literals(["client", "agent", "system"]);
export type EventDirection = Schema.Schema.Type<typeof EventDirectionEnum>;

/** Workflow status for agent work-item tracking. */
export const WorkflowStatusEnum = Schema.Literals([
  "planning",
  "implementing",
  "testing",
  "reviewing",
  "awaiting_input",
  "completed",
  "failed",
  "cancelled",
]);
export type WorkflowStatus = Schema.Schema.Type<typeof WorkflowStatusEnum>;

/** Type of artifact linked to a task run. */
export const ArtifactTypeEnum = Schema.Literals([
  "pr",
  "verification",
  "build",
  "test_report",
  "doc",
  "deliverable",
  "other",
]);
export type ArtifactType = Schema.Schema.Type<typeof ArtifactTypeEnum>;

/** Role an artifact plays in a task run. */
export const ArtifactRoleEnum = Schema.Literals([
  "primary",
  "review",
  "verification",
  "documentation",
  "deliverable",
  "build",
  "test_report",
  "other",
]);
export type ArtifactRole = Schema.Schema.Type<typeof ArtifactRoleEnum>;

// --- Record schemas ---------------------------------------------------------

/** A session (chat conversation) record. */
export const SessionSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  repositoryId: Schema.NullOr(Schema.String),
  worktreeId: Schema.NullOr(Schema.String),
  workingDirectory: Schema.NullOr(Schema.String),
  agentType: Schema.String,
  status: SessionStatusEnum,
  nextSeq: Schema.Number,
  lastActivityAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.Unknown),
  workItemId: Schema.NullOr(Schema.String),
  workItemIdentifierSnapshot: Schema.NullOr(Schema.String),
  planningTaskId: Schema.NullOr(Schema.String),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type SessionWire = Schema.Schema.Type<typeof SessionSchema>;

/** A single event recorded in a session. */
export const SessionEventSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  seq: Schema.Number,
  direction: EventDirectionEnum,
  eventType: Schema.String,
  payload: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.Date,
});
export type SessionEventWire = Schema.Schema.Type<typeof SessionEventSchema>;

/** A connection record for a session. */
export const SessionConnectionSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  gatewayId: Schema.String,
  connectedAt: Schema.Date,
  disconnectedAt: Schema.NullOr(Schema.Date),
});
export type SessionConnectionWire = Schema.Schema.Type<
  typeof SessionConnectionSchema
>;

/** Workflow state for a session. */
export const WorkflowStateSchema = Schema.Struct({
  sessionId: Schema.String,
  status: WorkflowStatusEnum,
  message: Schema.NullOr(Schema.String),
  phase: Schema.NullOr(Schema.String),
  progress: Schema.NullOr(Schema.String),
  updatedAt: Schema.Date,
});
export type WorkflowStateWire = Schema.Schema.Type<typeof WorkflowStateSchema>;

// --- Errors -----------------------------------------------------------------

/** Raised when a session lease is already held by another gateway. */
export class SessionLeaseConflictError extends Schema.TaggedErrorClass<SessionLeaseConflictError>()(
  "SessionLeaseConflictError",
  {
    sessionId: Schema.String,
    claimedByGatewayId: Schema.String,
  },
) {}
