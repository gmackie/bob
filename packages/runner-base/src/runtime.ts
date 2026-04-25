// Phase 6G Tasks 9 + 10 — RunnerRuntime: register + heartbeat + claim/dispatch.
//
// `RunnerRuntime.start(opts)` builds a transport-bound `RunnerRpc` client,
// calls `runner.register` (with retry), stashes the returned session token
// in an internal Ref, then forks two scope-tied fibers:
//   1. A heartbeat loop that POSTs `runner.heartbeat` on `heartbeatInterval`.
//   2. A claim loop that polls `runner.claimWork` on `claimInterval`,
//      dispatches matching tasks to user-registered `WorkHandler`s, and
//      streams handler events back via `runner.reportEvent`.
//
// Both fibers run until scope close and are automatically interrupted by
// `Effect.scoped`'s teardown.
//
// SIGTERM-drain (Task 11) extends this file: it reads `inFlightFibers` to
// wait for in-flight handler work to drain before unregistering.
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
//   - `Effect.forkScoped` ties background fibers to the caller's scope so
//     SIGTERM / `Effect.scoped` cleanup interrupts them (verified in 6E
//     retro).
//   - `Schedule.fixed(interval)` for both heartbeat and claim cadences
//     (verified in `effect/Schedule.d.ts:3192`).
//   - Loop errors are swallowed via `Effect.catch` (the Effect 4 name for
//     the old `Effect.catchAll`; see `Effect.d.ts:3935`) so the loop keeps
//     running even after the retry budget is exhausted.
//   - Handler failures: a `WorkHandler` returns `Effect<void, unknown>`.
//     We can't try/catch a generator that yields Effects (Effect doesn't
//     throw synchronously inside `Effect.gen`), so the handler's effect is
//     wrapped with `Effect.matchEffect({ onFailure, onSuccess })` — that
//     way both branches end in a `runner.reportEvent` call (terminal
//     `error` for failure, `status_change → completed` for success) and
//     the dispatch fiber surfaces a never-failing effect to `forkScoped`
//     and `Fiber.await`. `matchEffect` is preferred over `Effect.catch`
//     here because we want a *terminal* event on the success path too.
//   - Client procedure access: same OpaqueClient cast pattern used in
//     `@gmacko/client/agent.ts` — opaque-type the client and look up
//     procedures by tag string. Avoids fighting `RpcClient<Rpcs>`'s
//     mapped-property type at the call site.

import {
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Ref,
  Schedule,
  Schema,
  Scope,
  ServiceMap,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

import { RunnerRpc, type TaskRunEventType } from "@gmacko/runner-protocol";

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
  /** Claim-loop cadence. Default: 1 second. */
  readonly claimInterval?: Duration.Input;
  /**
   * Grace period for the SIGTERM drain finalizer to wait for in-flight
   * handlers before force-interrupting them. Default: 30 seconds.
   */
  readonly gracePeriodMs?: Duration.Input;
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

/**
 * A user-supplied callback that processes a single task run. Called by the
 * claim/dispatch loop after a `runner.claimWork` returns a matching task.
 *
 * `emit` calls `runner.reportEvent` (with retries + error swallowing) for
 * each event the handler wants to surface back to the server. The runtime
 * fires its own terminal `status_change → completed` event after the
 * handler resolves successfully, and an `error` event if the handler
 * effect fails.
 */
export type WorkHandler = (input: {
  readonly runId: string;
  readonly capability: string;
  readonly input: unknown;
  readonly emit: (event: {
    readonly type: TaskRunEventType;
    readonly payload: unknown;
    readonly seq?: number;
  }) => Effect.Effect<void>;
}) => Effect.Effect<void, unknown>;

export interface RunnerRuntimeShape {
  readonly start: (
    opts: StartOptions,
  ) => Effect.Effect<void, RuntimeStartError, Scope.Scope>;
  readonly handle: (
    capability: string,
    handler: WorkHandler,
  ) => Effect.Effect<void>;
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

    // Capability → handler map. Mutated synchronously via `handle()`. The
    // claim loop reads it by snapshot per tick (`Array.from(handlers.keys())`)
    // so adding a handler after `start()` is safe — it'll be picked up on the
    // next tick. We deliberately use a plain `Map` rather than a Ref because
    // (a) all reads/writes happen on JS's single thread (b) we don't need
    // STM-style atomic update semantics here.
    const handlers = new Map<string, WorkHandler>();

    // In-flight handler fibers. Populated when a handler is dispatched,
    // removed when it completes. Task 11's drain logic reads this set to
    // know when "all in-flight work is done"; Task 10 just maintains it.
    const inFlightFibers = new Set<Fiber.Fiber<unknown, unknown>>();

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

        // --- Handlers scope (Task 11 drain coordination) ------------------
        //
        // We deliberately fork user-supplied `WorkHandler` fibers into a
        // *separate* scope from the heartbeat/claim loops and the caller's
        // scope. Why: when the caller's scope closes, finalizers run in
        // LIFO order — but `forkScoped` registers an interrupt-on-close
        // finalizer per fiber as it's forked, and the dispatch fiber forks
        // the handler at runtime *after* the drain finalizer is registered
        // (since dispatch happens during loop ticks, post-`start`). LIFO
        // means a handler's interrupt would run *before* the drain
        // finalizer, defeating the whole purpose. Pinning handlers to a
        // dedicated scope we close ourselves keeps drain in control of when
        // they get interrupted.
        const handlersScope = yield* Scope.make("sequential");

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

        // --- Claim + dispatch fiber (scoped) ---
        //
        // Polls `runner.claimWork` on `claimInterval` with the current set of
        // registered capabilities. On a hit, dispatches to the matching
        // handler in a child fiber tracked in `inFlightFibers`. We
        // `Fiber.await` that fiber from the loop tick so we don't claim a
        // second task in parallel — sequential claim/run/claim is the
        // intended contract for v1 (Phase 6G).
        const claimInterval = opts.claimInterval ?? Duration.seconds(1);

        const claimLoop = Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          if (state === null || state.status === "draining") return;

          const capabilityFilter = Array.from(handlers.keys());
          if (capabilityFilter.length === 0) return;

          const claimEffect = client["runner.claimWork"]!({
            capabilityFilter,
          }) as Effect.Effect<unknown, unknown, never>;
          const claimed = yield* Effect.catch(withRetry(claimEffect), () =>
            Effect.succeed(null),
          );
          if (claimed === null || claimed === undefined) return;

          // The wire schema for claimWork's success is `NullOr(TaskRunSchema)`.
          // We've already filtered out null above; treat the rest as a task.
          const task = claimed as {
            readonly id: string;
            readonly capabilitiesRequired: ReadonlyArray<string>;
            readonly input: unknown;
          };

          const matched = task.capabilitiesRequired.find((c) =>
            handlers.has(c),
          );
          const reportEvent = (event: {
            readonly type: TaskRunEventType;
            readonly payload: unknown;
            readonly seq?: number;
          }): Effect.Effect<void> => {
            const reportEffect = client["runner.reportEvent"]!({
              runId: task.id,
              type: event.type,
              payload: event.payload,
              seq: event.seq,
            }) as Effect.Effect<unknown, unknown, never>;
            return Effect.catch(
              withRetry(reportEffect),
              () => Effect.void,
            ).pipe(Effect.asVoid);
          };

          if (matched === undefined) {
            // Server handed us a task whose capabilities don't intersect our
            // registered handlers. Report no_handler and bail — server will
            // re-queue or fail the task by policy.
            yield* reportEvent({
              type: "error",
              payload: {
                reason: "no_handler",
                capabilities: task.capabilitiesRequired,
              },
            });
            return;
          }

          const handler = handlers.get(matched)!;
          yield* Ref.update(stateRef, (s): RuntimeState | null =>
            s ? { ...s, status: "busy" as RunnerStatus } : s,
          );

          // Build the handler effect with both terminal paths baked in: on
          // success, emit `status_change → completed`; on failure, emit
          // `error` with the message. `Effect.matchEffect` lets us replace
          // the whole result with a single terminal reportEvent on either
          // branch, which is what the runtime contract requires (every
          // dispatched task gets exactly one terminal event).
          const handlerEffect = handler({
            runId: task.id,
            capability: matched,
            input: task.input,
            emit: reportEvent,
          }).pipe(
            Effect.matchEffect({
              onFailure: (err) =>
                reportEvent({
                  type: "error",
                  payload: {
                    message: err instanceof Error ? err.message : String(err),
                  },
                }),
              onSuccess: () =>
                reportEvent({
                  type: "status_change",
                  payload: { status: "completed" },
                }),
            }),
          );

          // Handler fiber lives in `handlersScope`, NOT the surrounding
          // (claim-loop) scope, so `forkIn` instead of `forkScoped`. This is
          // what gives the drain finalizer authority over interrupt timing.
          const handlerFiber = yield* Effect.forkIn(
            handlerEffect,
            handlersScope,
          );
          // `Fiber<void, never>` from the matchEffect-narrowed branch widens
          // to the in-flight set's `Fiber<unknown, unknown>` covariantly.
          const trackedFiber =
            handlerFiber as unknown as Fiber.Fiber<unknown, unknown>;
          inFlightFibers.add(trackedFiber);
          // Wait for the handler to finish before claiming again. `await`
          // returns an Exit; we don't care about the value here — failures
          // already routed through `matchEffect` above.
          yield* Fiber.await(trackedFiber);
          inFlightFibers.delete(trackedFiber);

          // Drop back to idle if no other fibers are in-flight. (Today we
          // only ever fork one at a time, but Task 11's drain logic will
          // appreciate the explicit check.)
          if (inFlightFibers.size === 0) {
            yield* Ref.update(stateRef, (s): RuntimeState | null =>
              s && s.status === "busy"
                ? { ...s, status: "idle" as RunnerStatus }
                : s,
            );
          }
        }).pipe(Effect.repeat(Schedule.fixed(claimInterval)));

        yield* Effect.forkScoped(claimLoop);

        // --- SIGTERM drain finalizer (Task 11) ------------------------------
        //
        // Register a finalizer on the caller's scope. When the scope closes
        // (which happens automatically on `Effect.scoped` teardown — the
        // production analogue is a `process.on("SIGTERM", ...)` handler that
        // closes the runtime's scope), this runs four steps in order:
        //   1. Flip status → "draining" (the claim loop's check at the top
        //      of each tick exits early once it sees this).
        //   2. Best-effort draining heartbeat so the server learns the
        //      runner is going away even if `unregister` later fails.
        //   3. Wait for `inFlightFibers` to drain, racing a grace timer.
        //      Past grace, force-interrupt remaining fibers.
        //   4. Best-effort `runner.unregister`.
        //
        // Drift notes:
        //   - `Scope.addFinalizer(scope, finalizer: Effect<unknown>)` —
        //     finalizer is an Effect *value*, NOT a `() => Effect<...>`.
        //     For the "exit-aware" variant use `Scope.addFinalizerExit`
        //     (we don't need the Exit here).
        //   - `Effect.scope` is the canonical way to grab the current scope
        //     from inside `Effect.gen` (typed `Effect<Scope, never, Scope>`).
        //   - `Fiber.interrupt(fiber): Effect<void>` (NOT `Effect<Exit>`).
        //     `Fiber.interruptAll(iter)` is the multi-fiber convenience.
        //   - `Effect.race(a, b)` — first to complete wins; loser is
        //     interrupted automatically. We use it to bound the drain wait
        //     by `gracePeriodMs`: the drain-loop branch wins the natural
        //     case; the timer branch wins on hang and force-interrupts.
        const grace = opts.gracePeriodMs ?? Duration.seconds(30);
        const scope = yield* Effect.scope;

        const drainFinalizer = Effect.gen(function* () {
          // 1. Flip status to draining so the claim loop stops claiming.
          yield* Ref.update(stateRef, (s): RuntimeState | null =>
            s ? { ...s, status: "draining" as RunnerStatus } : s,
          );

          // 2. Send a final draining heartbeat — best-effort. We swallow
          //    errors here because the finalizer must always run to
          //    completion even if the network is gone.
          const drainingHeartbeat = client["runner.heartbeat"]!({
            status: "draining",
          }) as Effect.Effect<unknown, unknown, never>;
          yield* Effect.catch(withRetry(drainingHeartbeat), () => Effect.void);

          // 3. Drain in-flight fibers, bounded by grace.
          //    `drainAll` polls because handlers complete and remove
          //    themselves from the set asynchronously; snapshotting then
          //    `Fiber.await`-ing each one is the simplest race-free wait.
          const drainAll = Effect.gen(function* () {
            while (inFlightFibers.size > 0) {
              const snapshot = Array.from(inFlightFibers);
              yield* Effect.all(snapshot.map((f) => Fiber.await(f)));
            }
          });

          const graceTimer = Effect.gen(function* () {
            yield* Effect.sleep(grace);
            // Grace expired — force-interrupt anything still in-flight.
            // We grab a fresh snapshot here because the set might have
            // shrunk between the timer firing and this line running.
            const stragglers = Array.from(inFlightFibers);
            yield* Fiber.interruptAll(stragglers);
          });

          yield* Effect.race(drainAll, graceTimer);

          // Now that handlers have either finished or been interrupted,
          // close the handlers scope so any straggler resources release.
          yield* Scope.close(handlersScope, Exit.void);

          // 4. Unregister — best-effort.
          const unregisterEffect = client["runner.unregister"]!({
            reason: "graceful shutdown",
          }) as Effect.Effect<unknown, unknown, never>;
          yield* Effect.catch(withRetry(unregisterEffect), () => Effect.void);
        });

        // Add the drain finalizer *and* a fallback that closes
        // `handlersScope` unconditionally. Order matters here — the drain
        // finalizer is registered last so LIFO runs it first; the fallback
        // is registered first so it always runs at the end as a safety net
        // even if the drain effect is interrupted partway through.
        yield* Scope.addFinalizer(
          scope,
          Scope.close(handlersScope, Exit.void),
        );
        yield* Scope.addFinalizer(scope, drainFinalizer);
      });

    const setStatus = (status: RunnerStatus): Effect.Effect<void> =>
      Ref.update(stateRef, (s): RuntimeState | null =>
        s ? { ...s, status } : s,
      );

    const currentStatus = (): Effect.Effect<RunnerStatus | null> =>
      Ref.get(stateRef).pipe(Effect.map((s) => (s ? s.status : null)));

    // Handler registration is synchronous — we just mutate the closure-scoped
    // Map. Effect-typing the return as `Effect<void>` keeps the API uniform
    // with the rest of the surface (every other RunnerRuntime method is an
    // Effect). Newly-added handlers are picked up on the next claim tick.
    const handle = (
      capability: string,
      handler: WorkHandler,
    ): Effect.Effect<void> =>
      Effect.sync(() => {
        handlers.set(capability, handler);
      });

    return {
      start,
      handle,
      setStatus,
      currentStatus,
    } satisfies RunnerRuntimeShape;
  }),
);
