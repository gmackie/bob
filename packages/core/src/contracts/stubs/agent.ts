// Deterministic in-memory stub handlers for the AgentRpc group.
//
// OODA (and any other consumer) mounts this layer during dev so they can code
// against real Schema types while gmacko back-fills the runtime services in
// 6J. Returns a fixed conversation id, a fixed "user said X" stub stream, and
// a fixed 2-message transcript.
//
// Shape notes:
//   - `RpcGroup.toLayer(handlers)` builds the server-side Layer consumed by
//     `RpcServer.layerHttp`. Streaming handlers may return `Stream<A, E, R>`
//     directly OR `Effect<Queue.Dequeue<A, E | Cause.Done>, EX, R>` per
//     `effect/unstable/rpc/Rpc.d.ts:277`. This stub returns `Stream` directly
//     (simplest shape — no queue bookkeeping needed).
//   - `RpcGroup.of(handlers)` returns the raw handler record typed against
//     the group. Exposing both the Layer (for server mounting) and the raw
//     handlers (for unit tests that invoke a single handler without the
//     full RPC machinery) keeps tests trivial.
//   - `Stream.fromIterable` + `Stream.fail` are the two primitives needed
//     for deterministic streaming output. Both exist in Effect 4.0.0-beta.43
//     (`Stream.d.ts:698,858`).

import { Effect, Stream } from "effect";

import { AgentSessionNotFoundError } from "@gmacko/core/agent/errors";

import { AgentRpc } from "../groups/agent.js";

const STUB_CONVERSATION_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const STUB_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const STUB_USER_ID = "user_stub_abc";
const STUB_MODEL = "claude-sonnet-4";

const handlers = AgentRpc.of({
  "agent.createSession": (_payload) =>
    Effect.succeed({
      conversationId: STUB_CONVERSATION_ID,
      status: "pending" as const,
    }),

  "agent.sendTurn": ({ conversationId, prompt }) => {
    if (conversationId !== STUB_CONVERSATION_ID) {
      return Stream.fail(
        new AgentSessionNotFoundError({
          conversationId,
          tenantId: STUB_TENANT_ID,
        }),
      );
    }
    return Stream.fromIterable([
      {
        type: "session_init" as const,
        externalSessionId: "stub-ext-session",
        model: STUB_MODEL,
      },
      {
        type: "text_delta" as const,
        text: `you said: ${prompt}`,
      },
      {
        type: "turn_end" as const,
        stopReason: "end_turn",
      },
    ]);
  },

  "agent.cancelSession": ({ conversationId }) =>
    conversationId === STUB_CONVERSATION_ID
      ? Effect.void
      : Effect.fail(
          new AgentSessionNotFoundError({
            conversationId,
            tenantId: STUB_TENANT_ID,
          }),
        ),

  "agent.closeSession": ({ conversationId }) =>
    conversationId === STUB_CONVERSATION_ID
      ? Effect.void
      : Effect.fail(
          new AgentSessionNotFoundError({
            conversationId,
            tenantId: STUB_TENANT_ID,
          }),
        ),

  "agent.getTranscript": ({ conversationId }) => {
    if (conversationId !== STUB_CONVERSATION_ID) {
      return Effect.fail(
        new AgentSessionNotFoundError({
          conversationId,
          tenantId: STUB_TENANT_ID,
        }),
      );
    }
    return Effect.succeed({
      conversation: {
        id: STUB_CONVERSATION_ID,
        tenantId: STUB_TENANT_ID,
        userId: STUB_USER_ID,
        title: null,
        adapterId: "claude-code",
        status: "completed" as const,
        metadata: {},
        createdAt: new Date("2026-04-21T00:00:00.000Z"),
        updatedAt: new Date("2026-04-21T00:00:10.000Z"),
      },
      messages: [
        {
          id: "msg-1",
          conversationId: STUB_CONVERSATION_ID,
          seq: 1,
          role: "user" as const,
          content: "hello",
          metadata: {},
          createdAt: new Date("2026-04-21T00:00:01.000Z"),
        },
        {
          id: "msg-2",
          conversationId: STUB_CONVERSATION_ID,
          seq: 2,
          role: "assistant" as const,
          content: "hi there",
          metadata: {},
          createdAt: new Date("2026-04-21T00:00:09.000Z"),
        },
      ],
    });
  },
});

/**
 * Stub handlers for the AgentRpc group.
 *
 * - `.layer` — `Layer.Layer<Rpc.ToHandler<AgentRpc>, never, never>` ready to
 *   be provided to `RpcServer.layerHttp`.
 * - `.handlers` — raw handler record keyed by RPC tag. Useful for unit tests
 *   that invoke a single handler directly without instantiating the full
 *   RPC server machinery.
 */
export const stubAgentHandlers = {
  layer: AgentRpc.toLayer(handlers),
  handlers,
  constants: {
    conversationId: STUB_CONVERSATION_ID,
    tenantId: STUB_TENANT_ID,
    userId: STUB_USER_ID,
    model: STUB_MODEL,
  },
} as const;
