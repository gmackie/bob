// Phase 6G Task 9 — RunnerRuntime: register + heartbeat half.
//
// `RunnerRuntime.start(opts)` builds a transport-bound `RunnerRpc` client,
// calls `runner.register` (with retry), stashes the returned session token
// in an internal Ref, then forks a heartbeat fiber inside the caller's scope.
// The fiber runs until scope close and is automatically interrupted by
// `Effect.scoped`'s teardown.
//
// Claim/dispatch/SIGTERM-drain land in Tasks 10–11 (extending this file).
//
// Design decisions / drift notes:
//   - `RpcClient.layerProtocolHttp({ url, transformClient? })` — the only
//     supported options. Custom fetch flows in via the
//     `FetchHttpClient.Fetch` ServiceMap reference (verified in 6F drift
//     work). No `headers` option exists; per-request header injection
//     happens through `transformClient`.
//   - Per-request `X-Runner-Session` header injection: the
//     `transformClient` callback runs synchronously each time a request is
//     built. We close over a plain `let currentToken: string | null = null`
//     captured in the closure rather than reading a `Ref` via
//     `Effect.runSync`. Why: the `mapRequest` callback path is sync and
//     framework-internal; reaching back into the fiber-scoped runtime to
//     read a Ref adds friction (Effect.runSync requires `R = never`) and
//     `Ref.get` for a single mutable string isn't buying us anything that
//     a closure variable doesn't already give us. We *also* mirror the
//     value into a Ref so that `currentStatus()` and `setStatus` can
//     interact with it via Effect from outside `start`.
//   - `Effect.forkScoped` ties the heartbeat fiber to the caller's scope
//     so SIGTERM / `Effect.scoped` cleanup interrupts it (verified in 6E
//     retro).
//   - `Schedule.fixed(interval)` for the heartbeat cadence (verified in
//     `effect/Schedule.d.ts:3192`).
//   - Heartbeat errors are swallowed via `Effect.catch` (the Effect 4 name
//     for the old `Effect.catchAll`; see `Effect.d.ts:3935`) so the loop
//     keeps running even after the retry budget is exhausted.
//   - Client procedure access: same OpaqueClient cast pattern used in
//     `@gmacko/client/agent.ts` — opaque-type the client and look up
//     procedures by tag string. Avoids fighting `RpcClient<Rpcs>`'s
//     mapped-property type at the call site.

import {
  Duration,
  Effect,
  Layer,
  Ref,
  Schedule,
  Schema,
  type Scope,
  ServiceMap,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

import { RunnerRpc } from "@gmacko/runner-protocol";

import { withRetry } from "./retry.js";

// --- Public types ----------------------------------------------------------

export type RunnerStatus = "idle" | "busy" | "draining";

export interface StartOptions {
  readonly baseURL: string;
  readonly hostname: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly apiKeyBearer: string;
  /** Heartbeat cadence. Default: 10 seconds. */
  readonly heartbeatInterval?: Duration.Input;
  /** Optional fetch override (e.g. for tests). */
  readonly fetch?: typeof fetch;
}

export class RuntimeStartError extends Schema.TaggedErrorClass<RuntimeStartError>()(
  "RuntimeStartError",
  {
    reason: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface RunnerRuntimeShape {
  readonly start: (
    opts: StartOptions,
  ) => Effect.Effect<void, RuntimeStartError, Scope.Scope>;
  readonly setStatus: (status: RunnerStatus) => Effect.Effect<void>;
  readonly currentStatus: () => Effect.Effect<RunnerStatus | null>;
}

interface RuntimeState {
  readonly deviceId: string;
  readonly sessionToken: string;
  readonly status: RunnerStatus;
}

export class RunnerRuntime extends ServiceMap.Service<
  RunnerRuntime,
  RunnerRuntimeShape
>()("@gmacko/runner-base/RunnerRuntime") {}

// --- OpaqueClient cast for RPC tag access ---------------------------------
//
// `RpcClient.make(RunnerRpc)` returns a struct keyed by RPC tag. With
// `noUncheckedIndexedAccess: true`, every dotted-tag lookup is `T |
// undefined`; rather than non-null-asserting at every call site we cast
// once to a tag-indexed record of `Effect`-returning functions. Mirrors
// the pattern in `@gmacko/client/agent.ts`.

type AnyRpcFn = (
  payload?: unknown,
) => Effect.Effect<unknown, unknown, unknown>;
type OpaqueClient = Record<string, AnyRpcFn>;

interface RegisterResponse {
  readonly deviceId: string;
  readonly sessionToken: string;
  readonly expiresAt: Date;
  readonly serverTime: Date;
}

// --- Layer -----------------------------------------------------------------

export const layerRunnerRuntime: Layer.Layer<RunnerRuntime> = Layer.effect(
  RunnerRuntime,
)(
  Effect.gen(function* () {
    // The single source-of-truth for deviceId/sessionToken/status. Reads
    // from `currentStatus` and writes from `setStatus` go through this Ref.
    const stateRef = yield* Ref.make<RuntimeState | null>(null);

    const start = (
      opts: StartOptions,
    ): Effect.Effect<void, RuntimeStartError, Scope.Scope> =>
      Effect.gen(function* () {
        // --- Transport layer ---
        // Mirror `currentToken` into a closure variable that `transformClient`
        // can read synchronously when building each request. Updated below
        // after `runner.register` succeeds. See module-level comment for why
        // we don't reach into `stateRef` from inside the transform.
        let currentToken: string | null = null;

        const protocolLayer = RpcClient.layerProtocolHttp({
          url: opts.baseURL,
          transformClient: (client) =>
            HttpClient.mapRequest(client, (request) => {
              if (currentToken === null) return request;
              return HttpClientRequest.setHeader(
                request,
                "X-Runner-Session",
                currentToken,
              );
            }),
        });

        const fetchLayer: Layer.Layer<HttpClient.HttpClient> = opts.fetch
          ? FetchHttpClient.layer.pipe(
              Layer.provide(Layer.succeed(FetchHttpClient.Fetch, opts.fetch)),
            )
          : FetchHttpClient.layer;

        const transportLayer = protocolLayer.pipe(
          Layer.provide(RpcSerialization.layerJson),
          Layer.provide(fetchLayer),
        );

        // --- Build the client (scoped) ---
        const rawClient = yield* RpcClient.make(RunnerRpc).pipe(
          Effect.provide(transportLayer),
        );
        const client = rawClient as unknown as OpaqueClient;

        // --- Register (with retry) ---
        const registerEffect = client["runner.register"]!({
          hostname: opts.hostname,
          capabilities: opts.capabilities,
          apiKeyBearer: opts.apiKeyBearer,
        }) as Effect.Effect<RegisterResponse, unknown, never>;

        const registerRes = yield* withRetry(registerEffect).pipe(
          Effect.mapError(
            (err) =>
              new RuntimeStartError({
                reason: "register failed",
                cause: err,
              }),
          ),
        );

        // Update both the in-fiber Ref and the closure-captured token used
        // by the request transform.
        currentToken = registerRes.sessionToken;
        yield* Ref.set(stateRef, {
          deviceId: registerRes.deviceId,
          sessionToken: registerRes.sessionToken,
          status: "idle" as RunnerStatus,
        });

        // --- Heartbeat fiber (scoped) ---
        const interval = opts.heartbeatInterval ?? Duration.seconds(10);

        const heartbeatLoop = Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (state === null) return;
          // Wrap the call in `withRetry` so transient failures don't break
          // the loop. Anything that escapes the retry budget is logged-and-
          // swallowed via `Effect.catch` — the next tick will try again.
          const heartbeatEffect = client["runner.heartbeat"]!({
            status: state.status,
          }) as Effect.Effect<unknown, unknown, never>;
          yield* Effect.catch(withRetry(heartbeatEffect), () => Effect.void);
        }).pipe(Effect.repeat(Schedule.fixed(interval)));

        yield* Effect.forkScoped(heartbeatLoop);
      });

    const setStatus = (status: RunnerStatus): Effect.Effect<void> =>
      Ref.update(stateRef, (s): RuntimeState | null =>
        s ? { ...s, status } : s,
      );

    const currentStatus = (): Effect.Effect<RunnerStatus | null> =>
      Ref.get(stateRef).pipe(Effect.map((s) => (s ? s.status : null)));

    return {
      start,
      setStatus,
      currentStatus,
    } satisfies RunnerRuntimeShape;
  }),
);
