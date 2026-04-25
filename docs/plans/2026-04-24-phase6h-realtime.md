# Phase 6H — `@gmacko/realtime`

PubSub + SSE/streaming infrastructure. Logical channels for cross-process fan-out, three backends (memory real, redis stub, ws-gateway stub), env-var-driven backend selection. Plus the long-deferred migration of `agent.sendTurn`'s RPC transport from `RpcSerialization.layerJson` (buffers streams) to `layerNdjson` (true chunked streaming), finishing the 6E/6F streaming story.

## Scope

**In scope (locked):**
- **`RealtimeBackend` env entry in `@gmacko/config`** — `Schema.Literals(["memory", "redis", "ws-gateway"])` exported from `packages/config/src/env.ts`. Default backend selection still up to consumers; the schema gives them a typed value to switch on.
- **`@gmacko/realtime` package filled in:**
  - `RealtimeChannel<A>` Effect service interface — `publish(channel: string, event: A) → Effect<void>`, `subscribe(channel: string) → Effect<Stream<A, RealtimeBackendError>, never, Scope>`. Generic over event type so each consumer instantiates a typed channel for their domain.
  - Tagged errors: `RealtimeBackendNotImplementedError`, `RealtimePublishError`.
  - **Memory backend** at `./backends/memory` — wraps `PubSub.unbounded<A>` per channel, lazily created. `Layer.effect` returns the service; subscribers get a `Stream` from `PubSub.subscribe + Stream.fromQueue`-style adapter.
  - **Redis backend** at `./backends/redis` — STUB ONLY. Implements the interface; every method returns `Effect.fail(new RealtimeBackendNotImplementedError({backend: "redis", reason}))`. No `redis` / `ioredis` dep. Real impl deferred to Bob migration when concrete callers exist.
  - **ws-gateway backend** at `./backends/ws-gateway` — STUB ONLY. Same pattern as Redis.
  - **`layerRealtime(backend, factory)`** factory — takes a `"memory" | "redis" | "ws-gateway"` literal + a per-channel schema/factory, returns the appropriate Layer.
  - SSE helpers at `./sse` — minimal: `streamToSseResponse(stream): Response` for HTTP route handlers that want to push a `Stream<unknown>` as `text/event-stream`. Only used at the transport boundary; pubsub consumers stay pure Effect.
- **`agent.sendTurn` transport migration** — swap `RpcSerialization.layerJson` for `RpcSerialization.layerNdjson` in the e2e test wiring + document the upgrade path for 6K. The layer swap is server-side (`RpcServer.layerHttp` config) and client-side (`RpcClient.layerProtocolHttp` config). True chunked streaming end-to-end.
- **Subpath exports** in `@gmacko/realtime/package.json`: `.`, `./backends/memory`, `./backends/redis`, `./backends/ws-gateway`, `./sse`.

**Deferred:**
- **Real Redis impl** — requires committing to `redis` / `ioredis` / specific cluster client. Land when a real consumer is in-tree.
- **Real ws-gateway impl** — requires the `@gmacko/ws-gateway` package (scaffolded at 6A, empty) to actually exist as a service. Defer to when there's a hosted gateway to point at.
- **Replay / message persistence** — the memory backend is fire-and-forget. Channels with replay semantics need backend-side history (Redis Streams, Kafka). Future phase.
- **Cross-tenant fan-out hardening** — channel names are plain strings; consumers must include tenant scope in the channel name. No schema-level enforcement in 6H.
- **Real signal-handler bridge** for runner SIGTERM (carried over from 6G) — same story; consumer's job to map process signals to scope close.

## Exit criteria

- **33 packages** (no new — `realtime` already scaffolded at 6A). `pnpm -r typecheck` green.
- Full test suite ≥ 295 passing (up from 276). Expected breakdown:
  - Baseline 6G: 276
  - Task 1 (REALTIME_BACKEND config entry): +2
  - Task 2 (RealtimeChannel interface + errors): +2
  - Task 3 (memory backend): +5
  - Task 4 (redis stub): +2
  - Task 5 (ws-gateway stub): +2
  - Task 6 (layerRealtime factory): +3
  - Task 7 (SSE helpers): +3
  - Task 8 (agent.sendTurn → layerNdjson migration): +1
  - Task 9 (barrel + layer test): +2
  - **Expected total: ~298** (over 295 floor).
- Memory backend round-trip: publish + subscribe on the same channel receives the event.
- Stub backends throw `RealtimeBackendNotImplementedError` when called.
- `layerRealtime("memory", ...)` produces a working Layer; `layerRealtime("redis", ...)` and `layerRealtime("ws-gateway", ...)` produce a Layer whose service throws on every call.
- `agent.sendTurn` chunked streaming verified end-to-end via the e2e test (events arrive incrementally, not buffered).

## Design decisions (locked)

- **Generic `RealtimeChannel<A>`.** Consumers instantiate per-domain typed channels. E.g. 6K could create `AgentEventsChannel = RealtimeChannel<AgentEvent>` for streaming agent events to UI subscribers.
- **Channel namespacing is the consumer's job.** A channel string is just a string; no enforcement of tenant scoping at the service level. Convention: `<tenant-id>:<scope>:<entity-id>` (e.g. `tenant-abc:agent-session:conv-xyz`).
- **Memory backend is per-process.** Fan-out works within one Node process. Cross-process fan-out requires Redis or ws-gateway. Single-server deployments (typical dev / small prod) are fine with memory.
- **Subscriptions are scoped.** `subscribe(channel)` returns `Effect<Stream<A>, never, Scope>`. The Scope owns the underlying `PubSub.Subscription` lifecycle — when the consumer's scope closes, the subscription unwinds. Mirrors the runner-base pattern from 6G.
- **Stub error shape.** `RealtimeBackendNotImplementedError { backend: "redis"|"ws-gateway", reason: string }`. Consumers can match via `_tag` to decide whether to fall back to memory or hard-fail.
- **`layerRealtime(backend, factory)` is the only public Layer constructor.** Internally it's `Layer.suspend(() => backend === "memory" ? layerMemory(factory) : ...)`. Direct backend Layer imports stay possible via `./backends/memory` etc. for advanced/test cases.
- **NdJson migration.** `layerJson` and `layerNdjson` are interchangeable Layer-level swaps — same shape, different on-wire framing. The migration is a 2-line change at server bootstrap + client bootstrap. The e2e test in `@gmacko/client/src/__tests__/e2e.test.ts` validates true chunked behavior.

## Effect 4 API additions

Preemptive drift check found NO new drift rows needed:
- `PubSub.bounded<A>(capacity)` / `PubSub.unbounded<A>(opts?)` — `effect/PubSub.d.ts:275, 391`.
- `PubSub.subscribe(self): Effect<Subscription<A>, never, Scope.Scope>` — scoped subscription, `effect/PubSub.d.ts:1020`.
- `PubSub.publish(self, value)` — `effect/PubSub.d.ts:694`.
- `RpcSerialization.layerJson` and `layerNdjson` — both Layer.Layer<RpcSerialization>; drop-in swap.
- `Stream.fromQueue` — already covered (used in 6E for adapter event bridge).

## Task breakdown

Each task = RED → GREEN → COMMIT. One subagent per task.

### Task 1: Add `RealtimeBackend` to `@gmacko/config`

Edit `packages/config/src/env.ts`:
```ts
export const RealtimeBackend = Schema.Literals(["memory", "redis", "ws-gateway"]);
export type RealtimeBackend = typeof RealtimeBackend.Type;
```

Tests — 2 cases:
1. Decoding `"memory"` / `"redis"` / `"ws-gateway"` succeeds.
2. Decoding `"kafka"` / `""` / undefined fails.

Commit: `feat(config): add RealtimeBackend env schema`

### Task 2: `RealtimeChannel` interface + tagged errors

`packages/realtime/src/channel.ts`:
```ts
export class RealtimePublishError extends Schema.TaggedErrorClass<RealtimePublishError>()(
  "RealtimePublishError",
  { channel: Schema.String, reason: Schema.String },
) {}

export class RealtimeBackendNotImplementedError extends Schema.TaggedErrorClass<RealtimeBackendNotImplementedError>()(
  "RealtimeBackendNotImplementedError",
  { backend: Schema.Literals(["redis", "ws-gateway"]), reason: Schema.String },
) {}

export interface RealtimeChannelShape<A> {
  readonly publish: (channel: string, event: A) => Effect.Effect<void, RealtimePublishError | RealtimeBackendNotImplementedError>;
  readonly subscribe: (channel: string) => Effect.Effect<
    Stream.Stream<A, RealtimeBackendNotImplementedError>,
    never,
    Scope.Scope
  >;
}

// ServiceMap.Service is generic-over-A only via factory pattern;
// consumers create their own typed instances. Provide a helper:
export const makeRealtimeChannelTag = <A>(name: string) =>
  ServiceMap.Service<RealtimeChannelShape<A>>()(name);
```

Tests — 2 cases:
1. Tagged errors construct + carry fields.
2. Helper produces a usable ServiceMap.Service tag.

Commit: `feat(realtime): add RealtimeChannel interface + tagged errors`

### Task 3: Memory backend

`packages/realtime/src/backends/memory.ts`:
```ts
export const layerMemory = <A>(tag: ServiceMap.Service<RealtimeChannelShape<A>, ...>) =>
  Layer.effect(tag)(
    Effect.gen(function* () {
      // Per-channel PubSub map. Lazy creation on first publish/subscribe.
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
            return Stream.fromQueue(sub);
          }),
      };
    }),
  );
```

Tests — 5 cases:
1. publish + subscribe on same channel: subscriber sees the event.
2. Two subscribers on same channel both see published event (fan-out).
3. Subscribers on different channels are isolated.
4. Subscribe inside scope; events arriving before subscribe ready are NOT seen (matches PubSub semantics — subscribe-before-publish is required for delivery).
5. Subscribe scope close releases the subscription.

Commit: `feat(realtime): add memory backend (PubSub-backed)`

### Task 4: Redis stub backend

`packages/realtime/src/backends/redis.ts`:
```ts
export const layerRedis = <A>(tag: ServiceMap.Service<...>) =>
  Layer.succeed(tag, {
    publish: () => Effect.fail(new RealtimeBackendNotImplementedError({ backend: "redis", reason: "redis backend deferred to Bob migration" })),
    subscribe: () => Effect.succeed(Stream.fail(new RealtimeBackendNotImplementedError({ backend: "redis", reason: "redis backend deferred to Bob migration" }))),
  });
```

Note: `subscribe` returns `Effect<Stream<...>>`. The Stream's first pull surfaces the error. Acceptable.

Tests — 2 cases:
1. publish fails with RealtimeBackendNotImplementedError.
2. subscribe returns a stream whose first pull fails with the same error.

Commit: `feat(realtime): add redis backend stub (deferred impl)`

### Task 5: ws-gateway stub backend

Same pattern as Task 4 but for `"ws-gateway"`.

Tests — 2 cases (analogous).

Commit: `feat(realtime): add ws-gateway backend stub (deferred impl)`

### Task 6: `layerRealtime(backend, ...)` factory

`packages/realtime/src/layer.ts`:
```ts
export const layerRealtime = <A>(
  backend: RealtimeBackend,
  tag: ServiceMap.Service<RealtimeChannelShape<A>, ...>,
): Layer.Layer<RealtimeChannelShape<A>, never, never> => {
  switch (backend) {
    case "memory": return layerMemory(tag);
    case "redis": return layerRedis(tag);
    case "ws-gateway": return layerWsGateway(tag);
  }
};
```

Tests — 3 cases:
1. `"memory"` produces a working Layer (publish + subscribe round-trips).
2. `"redis"` produces a Layer whose service throws.
3. `"ws-gateway"` produces a Layer whose service throws.

Commit: `feat(realtime): add layerRealtime factory (backend selection)`

### Task 7: SSE helpers

`packages/realtime/src/sse.ts`:
```ts
export const streamToSseResponse = <A>(
  stream: Stream.Stream<A>,
  encode: (a: A) => string = JSON.stringify,
): Effect.Effect<Response> =>
  Effect.sync(() => {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        async start(controller) {
          await Effect.runPromise(
            stream.pipe(
              Stream.tap((evt) =>
                Effect.sync(() => {
                  const line = `data: ${encode(evt)}\n\n`;
                  controller.enqueue(encoder.encode(line));
                }),
              ),
              Stream.runDrain,
            ),
          );
          controller.close();
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      },
    );
  });
```

Tests — 3 cases:
1. Stream of 3 events produces a `text/event-stream` Response with 3 `data: ...` lines.
2. Custom encode function used.
3. Response headers include `Cache-Control: no-cache`.

Commit: `feat(realtime): add streamToSseResponse SSE helper`

### Task 8: Migrate `agent.sendTurn` transport to layerNdjson

Edit `packages/client/src/__tests__/e2e.test.ts` and any related server config in `packages/contracts/src/stubs/*` if needed:
- Server-side: swap `RpcSerialization.layerJson` for `RpcSerialization.layerNdjson` where the test mounts the stub server.
- Client-side: same swap in `RpcClient.layerProtocolHttp` composition (verify this is configurable; if not, the swap is server-only and the client auto-detects via `Content-Type` — confirm by reading the d.ts).

Tests — 1 case:
1. `agent.sendTurn` round-trip via `layerNdjson`: assert events arrive incrementally rather than as one batch (use a stub handler with `Effect.sleep` between emits + measure the time-to-first-event vs time-to-last-event on the consumer).

If the timing assertion is flaky, settle for a "no buffering of stream" smoke check — assert the response body is line-delimited JSON via inspection.

Commit: `feat(realtime): migrate agent.sendTurn transport to layerNdjson (true chunked)`

### Task 9: `@gmacko/realtime` public barrel + layer test

`packages/realtime/src/index.ts`:
- Re-export `RealtimeChannelShape`, `RealtimePublishError`, `RealtimeBackendNotImplementedError`, `makeRealtimeChannelTag`, `layerRealtime`.
- Per-backend Layers via subpath: `./backends/{memory,redis,ws-gateway}`.
- SSE helper via `./sse`.
- `__gmackoRealtimePhase = "6h" as const`.

Update `packages/realtime/package.json` exports block with the 5 subpaths.

Layer smoke test — 2 cases:
1. Smoke test (existing from earlier scaffolding if present): sentinel resolves.
2. Constructed `layerRealtime("memory", tag)` provides the service in a test runtime.

Commit: `feat(realtime): finalize @gmacko/realtime public barrel`

### Task 10: Exit verification + tag

1. `pnpm -r --filter '!./apps/*' typecheck` green.
2. Full test suite ≥ 295 passing. Serial for PGlite-heavy packages.
3. Git tree clean.
4. Tag `phase-6h-complete`.
5. Append "Phase 6H — Completed" section to this plan.
6. Merge to master + push tag.

---

## Open items carried into 6I onboarding

- **Real Redis backend** — when a concrete cross-process consumer lands. Likely Bob migration.
- **Real ws-gateway backend** — when `@gmacko/ws-gateway` materializes.
- **Channel persistence / replay** — for "missed message" semantics. Requires backend-side history (Redis Streams, Kafka).
- **Tenant-scoped channel enforcement** — schema-level wrapper that requires tenant prefix. Defer until misuse becomes likely.
- **Backpressure tuning for memory backend** — `PubSub.unbounded` is fine for low-volume agent events; high-volume use (e.g. log streaming) might need `bounded` + slow-subscriber drop policy.
- **Long-poll / SSE-over-fetch fallback** for environments without proper SSE — out of scope.

## Convention reinforced

- Each task = RED → GREEN → COMMIT with dedicated subagent.
- Stubs over guessed implementations — Redis + ws-gateway can land later when callers materialize.
- Backend selection is a Layer composition concern, not a runtime branch.
- Subscribers are scoped — scope close = subscription release.
