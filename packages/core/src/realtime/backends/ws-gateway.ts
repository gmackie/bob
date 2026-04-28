// ws-gateway backend — STUB ONLY (Phase 6H, Task 5).
//
// Every method fails with `RealtimeBackendNotImplementedError`. The real
// implementation is deferred until the `@gmacko/ws-gateway` package
// (scaffolded at 6A, currently empty) materializes as an actual hosted
// service. Mirrors the redis stub; see `./redis.ts` for the parallel shape.
import { Effect, Layer, ServiceMap, Stream } from "effect";

import {
  type RealtimeChannelShape,
  RealtimeBackendNotImplementedError,
} from "../channel.js";

export const layerWsGateway = <A>(
  tag: ServiceMap.Service<RealtimeChannelShape<A>, RealtimeChannelShape<A>>,
): Layer.Layer<RealtimeChannelShape<A>> =>
  Layer.succeed(tag, {
    publish: (channel) =>
      Effect.fail(
        new RealtimeBackendNotImplementedError({
          backend: "ws-gateway",
          reason: `ws-gateway backend deferred — publish to "${channel}" cannot be served (no @gmacko/ws-gateway service)`,
        }),
      ),
    subscribe: (channel) =>
      Effect.succeed(
        Stream.fail(
          new RealtimeBackendNotImplementedError({
            backend: "ws-gateway",
            reason: `ws-gateway backend deferred — subscribe to "${channel}" cannot be served (no @gmacko/ws-gateway service)`,
          }),
        ),
      ),
  });
