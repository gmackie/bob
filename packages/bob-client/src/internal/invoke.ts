import { Effect, type Stream } from "effect";
import { RpcClient } from "effect/unstable/rpc";

import type { ClientRuntime } from "./runtime.js";

type AnyRpcFn = (
  payload?: unknown,
  options?: unknown,
) => Effect.Effect<unknown, unknown, unknown>;
type AnyStreamRpcFn = (
  payload?: unknown,
  options?: unknown,
) => Stream.Stream<unknown, unknown, unknown>;
type OpaqueClient = Record<string, AnyRpcFn & AnyStreamRpcFn>;

export type RpcMethod<I = unknown, O = unknown> = (input?: I) => Promise<O>;

export const makeInvoke =
  (runtime: ClientRuntime, group: unknown) =>
  <A>(tag: string, payload?: unknown): Promise<A> =>
    runtime.runEffect(
      Effect.flatMap(RpcClient.make(group as never), (client) => {
        const fn = (client as unknown as OpaqueClient)[tag]!;
        return fn(payload) as Effect.Effect<A, unknown, never>;
      }) as Effect.Effect<A, unknown, never>,
    );

export const makeStreamInvoke =
  (runtime: ClientRuntime, group: unknown) =>
  <A>(tag: string, payload?: unknown): AsyncIterable<A> => {
    const streamEffect = Effect.map(RpcClient.make(group as never), (client) => {
      const fn = (client as unknown as OpaqueClient)[tag]!;
      return fn(payload) as unknown as Stream.Stream<A, unknown>;
    });
    return runtime.runStream(streamEffect);
  };
