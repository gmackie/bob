// Agent Terminal schemas — wire-format contracts for Bob's terminal router.
//
// Mirrors the 5 procedures from
// `packages/bob/src/api/src/router/terminal.ts`.
//
// The terminal router creates PTY session handles (agent, directory, system)
// and returns lightweight result structs. No DB-backed record schema here —
// sessions are ephemeral.

import { Schema } from "effect";

// --- Result schemas ---------------------------------------------------------

/** Result of creating an agent terminal session. */
export const AgentTerminalSessionSchema = Schema.Struct({
  sessionId: Schema.String,
  instanceId: Schema.String,
  agentType: Schema.String,
});
export type AgentTerminalSessionWire = Schema.Schema.Type<
  typeof AgentTerminalSessionSchema
>;

/** Result of creating a directory terminal session. */
export const DirectoryTerminalSessionSchema = Schema.Struct({
  sessionId: Schema.String,
  instanceId: Schema.String,
  path: Schema.String,
});
export type DirectoryTerminalSessionWire = Schema.Schema.Type<
  typeof DirectoryTerminalSessionSchema
>;

/** Result of creating a system terminal session. */
export const SystemTerminalSessionSchema = Schema.Struct({
  sessionId: Schema.String,
  cwd: Schema.String,
  initialCommand: Schema.optional(Schema.String),
});
export type SystemTerminalSessionWire = Schema.Schema.Type<
  typeof SystemTerminalSessionSchema
>;
