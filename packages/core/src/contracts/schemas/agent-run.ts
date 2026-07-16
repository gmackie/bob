// Agent Run schemas — wire-format contract for Bob's agentRun router.
//
// This is a READ/display contract (the success schema for agent.run.get / list
// / listAll / listByWorkItem). It must NOT hard-fail on a status the contract
// didn't happen to enumerate: `Schema.Array(AgentRunSchema)` encodes
// atomically, so ONE row whose status is outside the literal set fails the
// WHOLE list response. That is exactly what blanked "Running Now" and the
// provider capacity cards — the literals were frozen at
// ["pending","running","completed","failed","cancelled"] while the DB enum grew
// to ["queued","running","completed","failed","interrupted","blocked",
// "host_unknown"], so any interrupted/blocked/queued/host_unknown run (e.g. a
// reaped one) broke the entire dashboard read. The claimed "handler-level
// mapping bridges the DB values" never existed — agentRunList returns raw rows.
// So `status` is a plain string here on purpose: the DB enum is the source of
// truth and display code maps it by value.
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
  // Which agent executed the run (claude / grok / codex / cursor). The
  // dashboard needs it to attribute a run to its provider; without it on the
  // wire every run defaulted to "codex" and Claude/Grok never got a card.
  agentType: Schema.NullOr(Schema.String),
  // Raw DB agent_run_status value — a plain string, not a narrowed union; see
  // the file header for why enumerating it here is a footgun.
  status: Schema.String,
  startedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  completedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  createdAt: Schema.DateTimeUtcFromString,
});
export type AgentRunWire = Schema.Schema.Type<typeof AgentRunSchema>;
