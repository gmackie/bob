// @gmacko/realtime — typed pubsub channels + SSE helpers.
//
// Public surface:
//   - `RealtimeChannelShape<A>` — generic channel interface (publish + scoped
//     subscribe).
//   - `makeRealtimeChannelTag<A>(name)` — factory for typed
//     `ServiceMap.Service` tags.
//   - `layerRealtime(backend, tag)` — backend-agnostic Layer factory.
//   - `RealtimePublishError`, `RealtimeBackendNotImplementedError` — tagged
//     errors.
//
// Backend-specific Layers via subpath (tree-shake friendly):
//   - `@gmacko/realtime/backends/memory` — full in-memory PubSub, fan-out
//     within one process.
//   - `@gmacko/realtime/backends/redis` — STUB (deferred to Bob migration).
//   - `@gmacko/realtime/backends/ws-gateway` — STUB (deferred until
//     `@gmacko/ws-gateway` materializes).
//
// SSE helper at `@gmacko/realtime/sse`:
//   - `streamToSseResponse(stream, encode?)` — push a `Stream<A>` to an HTTP
//     route handler as `text/event-stream`. Caller handles scope.
//
// The per-backend Layers are intentionally NOT re-exported from this main
// barrel. Consumers should compose via the unified `layerRealtime(backend,
// tag)` factory; the subpath imports remain available for advanced/test use
// cases.

export {
  RealtimeBackendNotImplementedError,
  RealtimePublishError,
  makeRealtimeChannelTag,
} from "./channel.js";
export type { RealtimeChannelShape } from "./channel.js";

export { layerRealtime } from "./layer.js";

/** Package version/phase sentinel — kept for the Task 1+2 smoke test. */
export const __gmackoRealtimePhase = "6h" as const;
