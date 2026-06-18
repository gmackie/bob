// Schema definitions for the AgentRpc group.
//
// The tagged-union `AgentEvent` (from `@gmacko/agent`'s `adapter.ts`) needs a
// Schema representation so it can serialize over RPC (in particular, through
// the streaming success channel of `agent.sendTurn`). Each tagged variant
// becomes a `Schema.Struct` with a `Schema.Literal(tag)` discriminator, all
// joined via `Schema.Union([...])`.
//
// Verified Effect 4.0.0-beta.43 APIs:
//   - `Schema.Union([ ...members ])` takes a tuple of Schemas (see Schema.d.ts:2626).
//   - `Schema.Literal("foo")` — single literal (Schema.d.ts:1359).
//   - `Schema.Literals(["a","b",...])` — literal union (Schema.d.ts:2667).
//   - `Schema.Unknown` — passthrough (Schema.d.ts:1538).
//   - `Schema.Record(key, value)` — positional args (Schema.d.ts:2114), NOT
//     the `{key,value}` shorthand that appears in some examples.
//   - `Schema.Date` — decoded to JS `Date` (Schema.d.ts:5218). Chosen over
//     `Schema.DateTimeUtcFromString` because the stub's `getTranscript`
//     handler returns plain JS `Date` values; tightening the wire encoding
//     to ISO-8601 can happen in 6J once the actual server-side encoder runs.

import { Schema } from "effect";

// --- AgentEvent tagged-union Schema -----------------------------------------

const AgentEventSessionInitSchema = Schema.Struct({
  type: Schema.Literal("session_init"),
  externalSessionId: Schema.String,
  model: Schema.String,
});

const AgentEventTurnStartSchema = Schema.Struct({
  type: Schema.Literal("turn_start"),
});

const AgentEventTextDeltaSchema = Schema.Struct({
  type: Schema.Literal("text_delta"),
  text: Schema.String,
});

const AgentEventToolUseSchema = Schema.Struct({
  type: Schema.Literal("tool_use"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
});

const AgentEventToolResultSchema = Schema.Struct({
  type: Schema.Literal("tool_result"),
  toolUseId: Schema.String,
  content: Schema.String,
  isError: Schema.Boolean,
});

const AgentEventTurnEndSchema = Schema.Struct({
  type: Schema.Literal("turn_end"),
  stopReason: Schema.String,
});

const AgentEventCanceledSchema = Schema.Struct({
  type: Schema.Literal("canceled"),
});

/**
 * Wire-format Schema for the `AgentEvent` tagged union emitted by every
 * `AgentAdapter`. Mirror of the runtime type in `@gmacko/agent`.
 */
export const AgentEventSchema = Schema.Union([
  AgentEventSessionInitSchema,
  AgentEventTurnStartSchema,
  AgentEventTextDeltaSchema,
  AgentEventToolUseSchema,
  AgentEventToolResultSchema,
  AgentEventTurnEndSchema,
  AgentEventCanceledSchema,
]);
export type AgentEventWire = Schema.Schema.Type<typeof AgentEventSchema>;

// --- Transcript shapes ------------------------------------------------------
//
// Mirror of `chat_conversations` + `chat_messages` minus DB-internal
// metadata.

export const ChatConversationSchema = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  userId: Schema.String,
  title: Schema.NullOr(Schema.String),
  adapterId: Schema.String,
  status: Schema.Literals([
    "pending",
    "active",
    "completed",
    "failed",
    "canceled",
  ]),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type ChatConversationWire = Schema.Schema.Type<
  typeof ChatConversationSchema
>;

export const ChatMessageSchema = Schema.Struct({
  id: Schema.String,
  conversationId: Schema.String,
  seq: Schema.Number,
  role: Schema.Literals(["user", "assistant", "system", "tool"]),
  content: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.Date,
});
export type ChatMessageWire = Schema.Schema.Type<typeof ChatMessageSchema>;
