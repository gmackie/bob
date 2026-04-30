// Phase 6F Task 6 — AgentRpc contract group.
//
// Five procedures — one of which (`agent.sendTurn`) is the first streaming
// RPC in gmacko. The streaming declaration uses the `stream: true` flag on
// `Rpc.make`; per Effect 4.0.0-beta.43 (`effect/unstable/rpc/Rpc.d.ts:287`)
// the success schema is transparently wrapped in `RpcSchema.Stream<Success,
// Error>` and the top-level `error` channel becomes `Schema.Never`. Error
// shapes flow through the stream itself.
//
// Tagged error classes come straight from `@gmacko/agent`:
//   - AgentSessionNotFoundError — the conversation doesn't exist in this tenant.
//   - TurnInProgressError       — another turn is already running for this conversation.
//   - AdapterSpawnError         — failed to start the adapter subprocess.
//   - AdapterExitError          — adapter subprocess exited abnormally.
// All four are `Schema.TaggedErrorClass` subclasses and hence Schema instances,
// so they drop into `Schema.Union([...])` for the stream's error channel.
//
// Drift finding: `Schema.Union` takes an array literal (NOT a variadic
// argument list), per Schema.d.ts:2626. Tagged errors with differing payload
// shapes typecheck fine inside the union at the error slot.

import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import {
  AdapterExitError,
  AdapterSpawnError,
  AgentSessionNotFoundError,
  TurnInProgressError,
} from "@gmacko/core/agent/errors";

import {
  AgentEventSchema,
  ChatConversationSchema,
  ChatMessageSchema,
} from "../schemas/agent.js";
import { AgentRunSchema } from "../schemas/agent-run.js";
import {
  CaptureTargetSchema,
  CaptureResultSchema,
} from "../schemas/agent-capture.js";
import { NotFoundError } from "../../rpc/errors.js";

/** Union of every error `agent.sendTurn` can surface (on its stream). */
export const AgentStreamErrorSchema = Schema.Union([
  AgentSessionNotFoundError,
  TurnInProgressError,
  AdapterSpawnError,
  AdapterExitError,
]);

// --- createSession ----------------------------------------------------------

export const AgentCreateSessionRpc = Rpc.make("agent.createSession", {
  payload: Schema.Struct({
    adapterId: Schema.String,
    title: Schema.optional(Schema.String),
    systemPrompt: Schema.optional(Schema.String),
    allowedTools: Schema.optional(Schema.Array(Schema.String)),
    cwd: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({
    conversationId: Schema.String,
    status: Schema.Literal("pending"),
  }),
});

// --- sendTurn (streaming) ---------------------------------------------------
//
// `stream: true` rewires the success/error channel semantics per
// `Rpc.d.ts:287-294`:
//   - success (declared)  → `RpcSchema.Stream<Success, Error>`
//   - error   (declared)  → `Schema.Never`
// Adapter errors flow *through* the stream, matching the `@gmacko/agent`
// convention where `AgentAdapter.sendTurn` returns `Stream<AgentEvent, AdapterError>`.

export const AgentSendTurnRpc = Rpc.make("agent.sendTurn", {
  stream: true,
  payload: Schema.Struct({
    conversationId: Schema.String,
    prompt: Schema.String,
  }),
  success: AgentEventSchema,
  error: AgentStreamErrorSchema,
});

// --- cancelSession ----------------------------------------------------------

export const AgentCancelSessionRpc = Rpc.make("agent.cancelSession", {
  payload: Schema.Struct({ conversationId: Schema.String }),
  success: Schema.Void,
  error: AgentSessionNotFoundError,
});

// --- closeSession -----------------------------------------------------------

export const AgentCloseSessionRpc = Rpc.make("agent.closeSession", {
  payload: Schema.Struct({ conversationId: Schema.String }),
  success: Schema.Void,
  error: AgentSessionNotFoundError,
});

// --- getTranscript ----------------------------------------------------------

export const AgentGetTranscriptRpc = Rpc.make("agent.getTranscript", {
  payload: Schema.Struct({ conversationId: Schema.String }),
  success: Schema.Struct({
    conversation: ChatConversationSchema,
    messages: Schema.Array(ChatMessageSchema),
  }),
  error: AgentSessionNotFoundError,
});

// --- agent.run.get -----------------------------------------------------------

export const AgentRunGetRpc = Rpc.make("agent.run.get", {
  payload: Schema.Struct({
    runId: Schema.String, // UUID
  }),
  success: AgentRunSchema,
  error: NotFoundError,
});

// --- agent.run.list ----------------------------------------------------------

export const AgentRunListRpc = Rpc.make("agent.run.list", {
  payload: Schema.Struct({
    workspaceId: Schema.String, // UUID
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(AgentRunSchema),
});

// --- agent.run.listByWorkItem ------------------------------------------------

export const AgentRunListByWorkItemRpc = Rpc.make("agent.run.listByWorkItem", {
  payload: Schema.Struct({
    workItemId: Schema.String,
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(AgentRunSchema),
  error: NotFoundError,
});

// --- agent.capture.listTargets -----------------------------------------------

export const AgentCaptureListTargetsRpc = Rpc.make(
  "agent.capture.listTargets",
  {
    payload: Schema.Void,
    success: Schema.Array(CaptureTargetSchema),
  },
);

// --- agent.capture.capture ---------------------------------------------------

export const AgentCaptureCaptureRpc = Rpc.make("agent.capture.capture", {
  payload: Schema.Struct({
    targetType: Schema.Literal("browser", "window", "screen"),
    targetId: Schema.optional(Schema.String),
    url: Schema.optional(Schema.String),
  }),
  success: CaptureResultSchema,
});

// --- Group ------------------------------------------------------------------

export const AgentRpc = RpcGroup.make(
  AgentCreateSessionRpc,
  AgentSendTurnRpc,
  AgentCancelSessionRpc,
  AgentCloseSessionRpc,
  AgentGetTranscriptRpc,
  AgentRunGetRpc,
  AgentRunListRpc,
  AgentRunListByWorkItemRpc,
  AgentCaptureListTargetsRpc,
  AgentCaptureCaptureRpc,
);
