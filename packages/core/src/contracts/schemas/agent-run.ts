// Agent Run schemas — wire-format contract for Bob's agentRun router.
//
// The status enum here is the contract-level set (superset of the DB enum
// `["queued", "running", "completed", "failed"]`). Handler-level mapping
// bridges the DB values to the wire values in Phase D.
//
// UUID fields use plain `Schema.String` on the wire (matching auth/projects
// convention); validation can be tightened with `Schema.isUUID()` checks
// at the handler level if needed.

import { Schema } from "effect";

// --- Agent Run --------------------------------------------------------------

export const AgentRunSchema = Schema.Struct({
  id: Schema.String, // UUID
  workspaceId: Schema.String, // UUID
  sessionId: Schema.NullOr(Schema.String), // UUID
  workItemId: Schema.NullOr(Schema.String),
  status: Schema.Literals([
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
  ]),
  startedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  completedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  createdAt: Schema.DateTimeUtcFromString,
});
export type AgentRunWire = Schema.Schema.Type<typeof AgentRunSchema>;
