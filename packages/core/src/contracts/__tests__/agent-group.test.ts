// Phase 6F Task 6 — AgentRpc group + stub handlers (incl. streaming sendTurn).
//
// Verifies:
//   1) RpcGroup composition resolves all 5 procedures by tag.
//   2) `agent.sendTurn` is declared streaming — its successSchema is an
//      `RpcSchema.Stream` (runtime detectable via `RpcSchema.isStreamSchema`).
//   3) The `agent.sendTurn` stub stream emits 3 deterministic events
//      matching the expected `AgentEvent` shapes.
//   4) `agent.sendTurn` with an unknown conversationId fails the stream
//      with `AgentSessionNotFoundError`.
//
// Uses `RpcTest.makeClient` — the canonical in-process round-trip pattern —
// to exercise the stub handlers via the real client/server dispatch path.
import { describe, it, expect } from "vitest";
import { Cause, Effect, Exit, Stream } from "effect";
import { RpcSchema, RpcTest } from "effect/unstable/rpc";

import { AgentSessionNotFoundError } from "@gmacko/core/agent/errors";

import {
  AgentCancelSessionRpc,
  AgentCloseSessionRpc,
  AgentCreateSessionRpc,
  AgentGetTranscriptRpc,
  AgentRpc,
  AgentSendTurnRpc,
} from "../groups/agent.js";
import { stubAgentHandlers } from "../stubs/agent.js";

const STUB_CONVERSATION_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("AgentRpc group composition", () => {
  it("resolves the original 5 procedures by tag", () => {
    const tags = Array.from(AgentRpc.requests.keys());
    // After 7B-4B Task 1, 10 total (original 5 + 5 new run/capture)
    expect(tags.length).toBeGreaterThanOrEqual(5);

    // Sanity-check: the individual Rpc values are present in the group.
    expect(AgentRpc.requests.get("agent.createSession")).toBe(
      AgentCreateSessionRpc,
    );
    expect(AgentRpc.requests.get("agent.sendTurn")).toBe(AgentSendTurnRpc);
    expect(AgentRpc.requests.get("agent.cancelSession")).toBe(
      AgentCancelSessionRpc,
    );
    expect(AgentRpc.requests.get("agent.closeSession")).toBe(
      AgentCloseSessionRpc,
    );
    expect(AgentRpc.requests.get("agent.getTranscript")).toBe(
      AgentGetTranscriptRpc,
    );
  });

  it("declares agent.sendTurn as a streaming procedure", () => {
    // When `stream: true`, Rpc.make wraps the success schema in
    // RpcSchema.Stream<Success, Error>. Runtime detection is via
    // `RpcSchema.isStreamSchema`.
    expect(RpcSchema.isStreamSchema(AgentSendTurnRpc.successSchema)).toBe(true);

    // Non-streaming procedures must NOT be stream-wrapped.
    expect(RpcSchema.isStreamSchema(AgentCreateSessionRpc.successSchema)).toBe(
      false,
    );
    expect(RpcSchema.isStreamSchema(AgentGetTranscriptRpc.successSchema)).toBe(
      false,
    );
  });
});

describe("stubAgentHandlers — agent.sendTurn streaming", () => {
  it("emits 3 deterministic events for the happy path", async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AgentRpc);
      const stream = client["agent.sendTurn"]({
        conversationId: STUB_CONVERSATION_ID,
        prompt: "hello",
      });
      const chunk = yield* Stream.runCollect(stream);
      return Array.from(chunk);
    });

    const events = await Effect.runPromise(
      program.pipe(
        Effect.provide(stubAgentHandlers.layer),
        Effect.scoped,
      ) as Effect.Effect<ReadonlyArray<unknown>, unknown, never>,
    );

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      type: "session_init",
      externalSessionId: "stub-ext-session",
      model: "claude-sonnet-4",
    });
    expect(events[1]).toEqual({
      type: "text_delta",
      text: "you said: hello",
    });
    expect(events[2]).toEqual({
      type: "turn_end",
      stopReason: "end_turn",
    });
  });

  it("fails the stream with AgentSessionNotFoundError for unknown conversationId", async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(AgentRpc);
      const stream = client["agent.sendTurn"]({
        conversationId: "not-a-real-id",
        prompt: "hello",
      });
      return yield* Effect.exit(Stream.runCollect(stream));
    });

    const exit = await Effect.runPromise(
      program.pipe(
        Effect.provide(stubAgentHandlers.layer),
        Effect.scoped,
      ) as Effect.Effect<Exit.Exit<unknown, unknown>, never, never>,
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const failure = Cause.findErrorOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag !== "Some") return;
    // The real client decodes error classes by tag back to their schema
    // constructors, so we can check on the `_tag` property.
    const err = failure.value as { readonly _tag: string; readonly conversationId?: string };
    expect(err._tag).toBe("AgentSessionNotFoundError");
    expect(err.conversationId).toBe("not-a-real-id");
  });
});
