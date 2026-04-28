// Agent facade for @gmacko/client. Mirrors AgentRpc — 5 procedures.
//
// `sendTurn` is the only streaming procedure: its return value is an
// `AsyncIterable<AgentEventWire>` that consumers iterate with `for await`.
// The underlying Stream is scoped inside the runtime; iteration failure
// propagates as a thrown tagged error (one of the four declared in
// `AgentStreamErrorSchema`).

import { Effect, type Stream } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import { AgentRpc } from "@gmacko/core/contracts/groups/agent";
import type {
  AgentEventWire,
  ChatConversationWire,
  ChatMessageWire,
} from "@gmacko/core/contracts/schemas/agent";

import type { ClientRuntime } from "./internal/runtime.js";

export interface AgentClient {
  readonly createSession: (input: {
    readonly adapterId: string;
    readonly title?: string | undefined;
    readonly systemPrompt?: string | undefined;
    readonly allowedTools?: ReadonlyArray<string> | undefined;
    readonly cwd?: string | undefined;
  }) => Promise<{
    readonly conversationId: string;
    readonly status: "pending";
  }>;
  readonly sendTurn: (input: {
    readonly conversationId: string;
    readonly prompt: string;
  }) => AsyncIterable<AgentEventWire>;
  readonly cancelSession: (input: {
    readonly conversationId: string;
  }) => Promise<void>;
  readonly closeSession: (input: {
    readonly conversationId: string;
  }) => Promise<void>;
  readonly getTranscript: (input: {
    readonly conversationId: string;
  }) => Promise<{
    readonly conversation: ChatConversationWire;
    readonly messages: ReadonlyArray<ChatMessageWire>;
  }>;
}

type AnyRpcFn = (
  payload?: unknown,
  options?: unknown,
) => Effect.Effect<unknown, unknown, unknown>;
type AnyStreamRpcFn = (
  payload?: unknown,
  options?: unknown,
) => Stream.Stream<unknown, unknown, unknown>;
type OpaqueClient = Record<string, AnyRpcFn & AnyStreamRpcFn>;

export const makeAgentClient = (runtime: ClientRuntime): AgentClient => {
  const invoke = <A>(tag: string, payload?: unknown): Promise<A> =>
    runtime.runEffect(
      Effect.flatMap(RpcClient.make(AgentRpc), (client) => {
        const fn = (client as unknown as OpaqueClient)[tag]!;
        return fn(payload) as Effect.Effect<A, unknown, never>;
      }) as Effect.Effect<A, unknown, never>,
    );

  const sendTurn = (input: {
    readonly conversationId: string;
    readonly prompt: string;
  }): AsyncIterable<AgentEventWire> => {
    const streamEffect = Effect.map(
      RpcClient.make(AgentRpc),
      (client) => {
        const fn = (client as unknown as OpaqueClient)["agent.sendTurn"]!;
        return fn(input) as unknown as Stream.Stream<AgentEventWire, unknown>;
      },
    );
    return runtime.runStream(streamEffect);
  };

  return {
    createSession: (input) =>
      invoke<{ readonly conversationId: string; readonly status: "pending" }>(
        "agent.createSession",
        input,
      ),
    sendTurn,
    cancelSession: (input) => invoke<void>("agent.cancelSession", input),
    closeSession: (input) => invoke<void>("agent.closeSession", input),
    getTranscript: (input) =>
      invoke<{
        readonly conversation: ChatConversationWire;
        readonly messages: ReadonlyArray<ChatMessageWire>;
      }>("agent.getTranscript", input),
  };
};
