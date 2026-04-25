import { Effect, Layer, ServiceMap, Stream } from "effect";

import {
  type RealtimeChannelShape,
  RealtimeBackendNotImplementedError,
} from "../channel.js";

/**
 * Redis backend — STUB. Every method fails with
 * `RealtimeBackendNotImplementedError`. Real implementation is deferred to
 * Bob migration (or whenever a concrete cross-process pubsub consumer
 * exists).
 *
 * Why a stub instead of a missing impl: the contract surface is locked now
 * so consumers can write `layerRealtime("redis", ...)` without runtime
 * errors at Layer construction. Real impl swap is a per-method rewrite,
 * not a contract change.
 *
 * `subscribe` returns `Effect<Stream<A, BackendError>, never, Scope>`. The
 * outer Effect succeeds (Effect.succeed) so subscribe-time wiring never
 * fails; the returned Stream fails on its first pull. This matches how a
 * "deferred backend" should behave at the Effect/Stream level — type-safe
 * end-to-end.
 */
export const layerRedis = <A>(
  tag: ServiceMap.Service<RealtimeChannelShape<A>, RealtimeChannelShape<A>>,
): Layer.Layer<RealtimeChannelShape<A>> =>
  Layer.succeed(tag, {
    publish: (channel) =>
      Effect.fail(
        new RealtimeBackendNotImplementedError({
          backend: "redis",
          reason: `redis backend deferred — publish to "${channel}" cannot be served`,
        }),
      ),
    subscribe: (channel) =>
      Effect.succeed(
        Stream.fail(
          new RealtimeBackendNotImplementedError({
            backend: "redis",
            reason: `redis backend deferred — subscribe to "${channel}" cannot be served`,
          }),
        ),
      ),
  });
