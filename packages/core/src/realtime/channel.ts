// Public interface + tagged errors for the realtime PubSub layer.
//
// `RealtimeChannelShape<A>` is generic over the event type so each domain
// (agent events, runner events, etc.) instantiates its own typed channel via
// `makeRealtimeChannelTag`. Backends (memory / redis / ws-gateway) implement
// this same shape behind the scenes — the consumer doesn't care which one is
// wired up, only that publish + subscribe round-trip the typed `A`.
//
// Backends + the `layerRealtime` factory land in subsequent 6H tasks (3-6).
// This file is interface-only.
import { Effect, Schema, ServiceMap, Stream } from "effect";
import type { Scope } from "effect";

// Tagged errors. Plain `Schema.String` for `channel` — the value is a
// caller-supplied conventionally-namespaced string (e.g.
// `tenant-abc:agent:conv-xyz`); we don't constrain its shape at the schema
// level, only document the convention in the 6H plan.
export class RealtimePublishError extends Schema.TaggedErrorClass<RealtimePublishError>()(
  "RealtimePublishError",
  {
    channel: Schema.String,
    reason: Schema.String,
  },
) {}

// `backend` is restricted to the two stub backends — the memory backend never
// throws "not implemented". If we add backends later (kafka, ws-gateway with
// real impl, etc.), extend this literal set.
export class RealtimeBackendNotImplementedError extends Schema.TaggedErrorClass<RealtimeBackendNotImplementedError>()(
  "RealtimeBackendNotImplementedError",
  {
    backend: Schema.Literals(["redis", "ws-gateway"]),
    reason: Schema.String,
  },
) {}

// Service shape. `A` is the event type — consumers create a typed instance
// per domain (e.g. `AgentEventsChannel` for `AgentEvent`).
//
// `subscribe` returns `Effect<Stream<A, ...>, never, Scope>`: the outer Effect
// requires a Scope for subscription lifecycle (mirrors `PubSub.subscribe`),
// and the Stream's error channel carries the same NotImplemented tag so stub
// backends can fail at first pull rather than at subscribe time.
export interface RealtimeChannelShape<A> {
  readonly publish: (
    channel: string,
    event: A,
  ) => Effect.Effect<void, RealtimePublishError | RealtimeBackendNotImplementedError>;
  readonly subscribe: (
    channel: string,
  ) => Effect.Effect<
    Stream.Stream<A, RealtimeBackendNotImplementedError>,
    never,
    Scope.Scope
  >;
}

// Helper: build a typed `ServiceMap.Service` tag for a domain channel.
//
// We use Effect 4's single-call `ServiceMap.Service<Identifier, Shape>(key)`
// form rather than the two-call class form. The class form's inferred return
// type leaks a non-exported `NodeInspectSymbol` from `effect/Inspectable`
// across a generic factory boundary, which trips TS4023 ("cannot be named").
// The function form returns a `Service<Identifier, Shape>` whose type can be
// fully named via the `Service` interface that `ServiceMap` re-exports.
//
// `Identifier` is `RealtimeChannelShape<A>` — opaque from the consumer's
// perspective; the runtime `key` string is what makes the tag unique. This
// matches the documented Effect 4 pattern for ad-hoc tag creation.
//
// Consumers call this once at module load and re-export the result, e.g.
//   export const AgentEventsChannel = makeRealtimeChannelTag<AgentEvent>(
//     "@gmacko/realtime/AgentEventsChannel",
//   );
export const makeRealtimeChannelTag = <A>(
  name: string,
): ServiceMap.Service<RealtimeChannelShape<A>, RealtimeChannelShape<A>> =>
  ServiceMap.Service<RealtimeChannelShape<A>>(name);
