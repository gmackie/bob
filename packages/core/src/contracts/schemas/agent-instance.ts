// Agent Instance schemas — wire-format contracts for Bob's instance router.
//
// Mirrors the 9 procedures from
// `packages/bob/src/api/src/router/instance.ts`.
//
// Enum values are the contract-level superset of Bob's DB enums
// (`agentTypeEnum`, `instanceStatusEnum` from `@bob/projects/schema`).
//
// UUID fields use plain `Schema.String` on the wire (matching
// auth/projects/agent-run convention).

import { Schema } from "effect";

// --- Enums ------------------------------------------------------------------

/** Agent type (matches Bob's agentTypeEnum). */
export const AgentTypeEnum = Schema.Literal(
  "claude",
  "kiro",
  "codex",
  "gemini",
  "opencode",
  "smol-agent",
  "cursor-agent",
  "elevenlabs",
);
export type AgentType = Schema.Schema.Type<typeof AgentTypeEnum>;

/** Instance lifecycle status (matches Bob's instanceStatusEnum). */
export const InstanceStatusEnum = Schema.Literal(
  "running",
  "stopped",
  "starting",
  "error",
);
export type InstanceStatus = Schema.Schema.Type<typeof InstanceStatusEnum>;

// --- Record schemas ---------------------------------------------------------

/** An agent instance record. */
export const AgentInstanceSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  repositoryId: Schema.String,
  worktreeId: Schema.String,
  agentType: Schema.String,
  status: InstanceStatusEnum,
  pid: Schema.NullOr(Schema.Number),
  port: Schema.NullOr(Schema.Number),
  errorMessage: Schema.NullOr(Schema.String),
  lastActivity: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.NullOr(Schema.String),
});
export type AgentInstanceWire = Schema.Schema.Type<typeof AgentInstanceSchema>;
