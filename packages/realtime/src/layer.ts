// `layerRealtime` — backend-agnostic Layer factory.
//
// Selects the appropriate backend Layer based on a `RealtimeBackend` literal,
// typically sourced from `@gmacko/config`'s env-var-typed schema. The
// returned Layer's requirement set is `never` — backends are selected at
// construction time, not via the runtime ServiceMap.
//
// The exhaustive `switch` on the `RealtimeBackend` union forces the literal
// set here and the one in `@gmacko/config`'s `RealtimeBackend = Schema.Literals
// (["memory","redis","ws-gateway"])` to stay in sync — TS will surface a
// "not all paths return" error if either side drifts.
//
// Internal backend Layers stay separately importable via
// `@gmacko/realtime/backends/{memory,redis,ws-gateway}` for tests or advanced
// callers; this factory is the documented public-facing constructor.
import type { Layer, ServiceMap } from "effect";

import type { RealtimeBackend } from "@gmacko/config";

import { layerMemory } from "./backends/memory.js";
import { layerRedis } from "./backends/redis.js";
import { layerWsGateway } from "./backends/ws-gateway.js";
import type { RealtimeChannelShape } from "./channel.js";

export const layerRealtime = <A>(
  backend: RealtimeBackend,
  tag: ServiceMap.Service<RealtimeChannelShape<A>, RealtimeChannelShape<A>>,
): Layer.Layer<RealtimeChannelShape<A>> => {
  switch (backend) {
    case "memory":
      return layerMemory(tag);
    case "redis":
      return layerRedis(tag);
    case "ws-gateway":
      return layerWsGateway(tag);
  }
};
