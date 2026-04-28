import { Effect, Layer, PubSub, type ServiceMap, Stream } from "effect";

import type { RealtimeChannelShape } from "../channel.js";

/**
 * In-memory realtime backend. Per-channel `PubSub.unbounded` instances are
 * lazily created on the first publish or subscribe for a given channel name
 * and stored in a `Map` captured by the Layer's closure. The map outlives
 * any individual subscribe scope, so subscriptions opened and closed over
 * time on the same channel all hit the same underlying PubSub.
 *
 * Semantics:
 *   - Publish + subscribe round-trips within a single Node process.
 *   - Multiple subscribers on the same channel both receive each event
 *     (PubSub fan-out).
 *   - Subscribers on different channels are isolated.
 *   - `PubSub.unbounded` has no replay buffer — events published before any
 *     subscriber registers are dropped. (Subscribe-then-publish is the
 *     supported pattern.)
 *
 * Cross-process fan-out is NOT supported here — that requires the redis or
 * ws-gateway backend (both stubbed in 6H, real impl deferred). Single-server
 * deployments are fine on memory.
 *
 * Subscriptions are scoped: `subscribe` returns `Effect<Stream, never, Scope>`,
 * mirroring `PubSub.subscribe`'s contract. When the consumer's scope closes,
 * the underlying `PubSub.Subscription` is released. The PubSub itself stays
 * alive in the closure for the lifetime of the Layer.
 *
 * Note on `Stream.fromSubscription` vs `Stream.fromQueue`: in Effect 4,
 * `PubSub.Subscription<A>` is its own type (not a `Queue.Dequeue<A>` directly),
 * so we use the dedicated `Stream.fromSubscription` helper to bridge into a
 * Stream. The Stream's error channel is `never` for the memory backend — the
 * shape's wider `RealtimeBackendNotImplementedError` error is widened by the
 * subscribe return type, never produced here.
 */
export const layerMemory = <A>(
  tag: ServiceMap.Service<RealtimeChannelShape<A>, RealtimeChannelShape<A>>,
): Layer.Layer<RealtimeChannelShape<A>> =>
  Layer.effect(tag)(
    Effect.gen(function* () {
      const channels = new Map<string, PubSub.PubSub<A>>();

      const getOrCreate = (name: string): Effect.Effect<PubSub.PubSub<A>> =>
        Effect.gen(function* () {
          const existing = channels.get(name);
          if (existing) return existing;
          const created = yield* PubSub.unbounded<A>();
          channels.set(name, created);
          return created;
        });

      return {
        publish: (channel, event) =>
          Effect.gen(function* () {
            const ps = yield* getOrCreate(channel);
            yield* PubSub.publish(ps, event);
          }),
        subscribe: (channel) =>
          Effect.gen(function* () {
            const ps = yield* getOrCreate(channel);
            const sub = yield* PubSub.subscribe(ps);
            return Stream.fromSubscription(sub);
          }),
      };
    }),
  );
