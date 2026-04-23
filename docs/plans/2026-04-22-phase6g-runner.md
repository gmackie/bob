# Phase 6G — `@gmacko/runner-protocol` + `@gmacko/runner-base`

Ship the runner protocol + runtime. Runners are worker processes that register with the gmacko server, advertise capabilities, claim work, and report events back. Same HTTP RPC transport as OODA (6F) — runners are just another RPC client with their own group and middleware.

## Scope

**In scope (locked):**
- **`RunnerSessions` service in `@gmacko/auth`** — stateless HMAC-signed opaque tokens issued on register, validated on every subsequent call. Key derived from existing `GMACKO_SECRET_ENCRYPTION_KEY` via `HMAC(master, "runner-session")` (same envelope pattern as 6D row keys). Token encodes `{deviceId, tenantId, issuedAt, expiresAt}`.
- **`RunnerSessionMiddleware`** in `@gmacko/auth` — sibling of `AuthMiddleware`. Reads `X-Runner-Session` header, validates via `RunnerSessions.validate`, provides `RunnerSession` ServiceMap.Service (new) to the procedure handler.
- **`@gmacko/runner-protocol`** package filled in:
  - Wire schemas: `TaskRunSchema`, `TaskRunEventSchema` (tagged union matching DB `task_run_event_type`), `CapabilitySchema = Schema.String` (no hard union — products introduce capabilities without touching gmacko).
  - `RunnerRpc` group with 4 procedures (all except `register` use `RunnerSessionMiddleware`):
    - `runner.register({tenantId, hostname, capabilities, apiKeyBearer}) → {deviceId, sessionToken, serverTime}`
    - `runner.heartbeat({status}) → {serverTime}`
    - `runner.claimWork({capabilityFilter}) → Schema.NullOr(TaskRunSchema)` (Option encoded as nullable)
    - `runner.reportEvent({runId, type, payload, seq?}) → void`
  - Tagged errors: `RunnerNotRegisteredError`, `InvalidApiKeyForRunnerError`, `TaskRunNotClaimableError`.
- **`@gmacko/runner-base`** package filled in:
  - `RunnerRuntime` Effect service: `start()`, `stop()`, `handle(capability, handler)` — register→heartbeat→claim→dispatch loop.
  - `WorkHandler` type + registry.
  - `retrySchedule()` helper — `Schedule.exponential(100ms, 2.0) ∘ Schedule.jittered ∘ Schedule.recurs(5)` — reusable retry policy for all server calls.
  - SIGTERM drain via `Effect.scoped` + `Scope.addFinalizer`: on interrupt, transition status → `"draining"`, wait for in-flight handlers to complete, then unregister.
  - `MockServer` test harness — spins up an in-memory RpcServer (following 6F's pattern) with a scripted task queue for integration tests.
- **Protocol integration test** — real runtime loop against a `MockServer`: register, heartbeat 3×, claim a scripted task, report 5 events, SIGTERM → drain → exit. Proves the full loop end-to-end.

**Deferred:**
- **Real server-side handler implementations** for `runner.*` — stubs/mocks are for the runtime integration tests only. Real handlers (backed by `task_runs` + `runner_devices` tables) land in 6K alongside the OODA stubs' real-service swap.
- **Cross-tenant runner pools** — a single runner belongs to one tenant. Multi-tenant runner fleets (e.g. for shared compute) come later.
- **Priority queues / affinity** — `claimWork` returns FIFO-by-creation. Priority + capability-weighted fairness are future enhancements.
- **Runner health check** (beyond heartbeat) — reservation timeouts for zombie runners handled by a future cron or 6H reactive pub/sub.
- **Encrypted payloads** — `taskRuns.input` + `reportEvent.payload` are plain jsonb. Payload-level encryption via `@gmacko/secrets` lands when a concrete workload needs it.

## Exit criteria

- **33 packages** (no new packages; `runner-protocol` + `runner-base` already scaffolded at 6A). `pnpm -r typecheck` green.
- Full test suite ≥ 270 passing (up from 246). Expected breakdown:
  - Baseline 6F: 246
  - Task 2 (RunnerSessions service): +5
  - Task 3 (RunnerSession middleware): +3
  - Task 5 (runner-protocol scaffold): +1
  - Task 6 (protocol schemas): +4
  - Task 7 (RunnerRpc group): +3
  - Task 8 (runner-base scaffold): +1
  - Task 9 (retry schedule helper): +3
  - Task 10 (register + heartbeat loop): +4
  - Task 11 (claim + dispatch loop): +3
  - Task 12 (SIGTERM drain): +2
  - Task 13 (MockServer + end-to-end integration): +3
  - **Expected total: ~278** (well over 270 floor).
- Protocol integration test passes end-to-end (register → 3 heartbeats → claim → 5 events → SIGTERM drain → unregister).
- Retry test: 2 transient heartbeat failures (injected via mock) recover within the schedule's budget.
- Drain test: in-flight task completes before runtime exits, even under SIGTERM mid-work.

## Design decisions (locked)

- **Transport = HTTP RPC** via the 6F stack. Runners use their own `@gmacko/runner-base` client (not `@gmacko/client` — different consumer shape, no promise-facade façade).
- **`runner.register` takes an API key**, returns a session token. API key is an existing `ApiKeys` row (tenant-scoped). Register validates via `ApiKeys.validateKey`; on success, inserts/upserts a `runner_devices` row with the given hostname + capabilities and mints a 1-hour `sessionToken`.
- **Session token encoding (HMAC-signed opaque):**
  ```
  payload = base64url(JSON.stringify({deviceId, tenantId, issuedAt, expiresAt}))
  signature = base64url(HMAC-SHA256(HMAC(master, "runner-session"), payload))
  token = `${payload}.${signature}`
  ```
  Stateless — no `runner_sessions` DB table. TTL = 1 hour; runner refreshes by re-registering. Validation = verify HMAC + expiry + optional deviceId existence check.
- **No `register`-middleware.** `runner.register` is public (authenticated only by API key). All other procedures require `RunnerSessionMiddleware` which populates `RunnerSession` into the handler's services.
- **`claimWork` pull model.** Runner polls with capability filter; server returns next pending `task_run` matching filter OR null. No push / long-poll / reservation lease in 6G.
- **`reportEvent` seq allocation.** Runner can provide `seq` (for idempotent retries) or omit it (server auto-assigns `MAX(seq)+1`). Either-or path.
- **Capabilities = plain strings.** `Schema.String` wire type; no enforcement. Product documentation lists the reference set: `claude-code`, `codex-cli`, `cursor-acp`, `vault-write`, `git-push`. Schema-level enforcement (literal union) is a future hardening if the set stabilizes.
- **Retry policy.** `Schedule.exponential(100ms, 2.0).pipe(Schedule.jittered).pipe(Schedule.intersect(Schedule.recurs(5)))`. 5 retries with jitter; total budget ~6s worst case.
- **Drain shape.** `RunnerRuntime` owns a `Ref.Set<Fiber.RuntimeFiber>` of in-flight handler fibers. SIGTERM → transition status to `draining` → wait for all fibers in the set → call `runner.unregister` (actually, we don't have an unregister procedure; the heartbeat just stops and the server marks offline on staleness). Confirm whether a graceful `runner.unregister` is needed.

Actually — **add `runner.unregister` (5th procedure)** since graceful shutdown is a first-class requirement. Payload: `{reason?: string}`. Effect: server marks `runner_devices.status = "offline"`. Happens inside SIGTERM drain after in-flight tasks complete.

Revised procedure count: 5.

## Effect 4 API additions

Preemptive drift check found NO new drift rows needed — all 6G APIs are already in the master plan reference table (confirmed in Task 43):
- `Schedule.exponential(base, factor?): Schedule<Duration>` — `effect/Schedule.d.ts:3062`.
- `Schedule.jittered(self)` — `effect/Schedule.d.ts:3491`.
- `Schedule.recurs(times)` — `effect/Schedule.d.ts:3577`.
- `Schedule.intersect(...)` and `Schedule.compose(...)` — standard composition.
- `Effect.retry(self, schedule)` — `effect/Effect.d.ts:6287`.
- `Effect.repeat(self, schedule)` — `effect/Effect.d.ts:12535`.
- `Option.some(a) / Option.none() / Option.Option<A>` — `effect/Option.d.ts:290, 322`.
- `Schema.NullOr(schema)` — `effect/Schema.d.ts:2685` — for encoding `Option<T>` as `T | null` on the wire.

## Task breakdown

Each task = RED → GREEN → COMMIT. One subagent per task.

### Task 1: `RunnerSession` ServiceMap.Service + token helpers

`packages/auth/src/runner-sessions.ts`:
- `RunnerSession` class (ServiceMap.Service with shape `{deviceId, tenantId}`).
- `RunnerSessions` Effect service:
  - `mint({deviceId, tenantId, ttlMs?}) → Effect<{token, expiresAt}>`.
  - `validate(token) → Effect<{deviceId, tenantId}, InvalidRunnerSessionError>`.
- `layerRunnerSessions` Layer — no GmackoDb dependency; uses env for HMAC key.

**Task 1 ships with Task 2 in one commit** since they're tightly coupled.

### Task 2: `RunnerSessionMiddleware` + 3 tests (RunnerSessions + middleware combined)

`packages/auth/src/runner-session-middleware.ts` — sibling of `AuthMiddleware`. Reads `X-Runner-Session` header via `HttpServerRequest`, calls `RunnerSessions.validate`, provides `RunnerSession` to the handler.

Tests — 5 cases in `packages/auth/src/__tests__/runner-sessions.test.ts`:
1. `mint + validate` round-trip with correct `{deviceId, tenantId}`.
2. Expired token → `InvalidRunnerSessionError { reason: "expired" }`.
3. Tampered signature → `InvalidRunnerSessionError { reason: "signature" }`.
4. Malformed token → `InvalidRunnerSessionError { reason: "malformed" }`.
5. (Integration) RPC round-trip with middleware populates `RunnerSession` — mirrors Task 2 of 6F's pattern via `RpcTest.makeClient`.

Plus 3 tests in `packages/auth/src/__tests__/runner-session-middleware.test.ts` covering the middleware surface (happy path, missing header → `UnauthorizedError`, invalid token → error channel).

Net: +5 in runner-sessions + +3 in middleware = +8 tests to `@gmacko/auth` (58 → 66).

**Combining the two tasks into one commit** because the middleware can't be tested without the minter existing.

Commit: `feat(auth): add RunnerSessions service + RunnerSessionMiddleware`

### Task 3: Scaffold `@gmacko/runner-protocol` deps

Mirror `@gmacko/secrets` / `@gmacko/client` package shape. Deps: `effect`, `@gmacko/auth` (for error re-exports), `@gmacko/validators` (for TenantId/DeviceId brands). DevDeps standard.

1 smoke test (`__gmackoRunnerProtocolPhase === "6g"`).

Commit: `chore(runner-protocol): scaffold deps for 6G`

### Task 4: Protocol schemas

`packages/runner-protocol/src/schemas.ts`:
- `DeviceIdSchema` — UUID brand (could re-export from @gmacko/validators if present there; otherwise inline).
- `CapabilitySchema = Schema.String`.
- `TaskRunStatusSchema` — `Schema.Literals([...])` mirroring DB enum.
- `TaskRunEventTypeSchema` — same for event type enum.
- `TaskRunSchema` — the full row shape.
- `TaskRunEventSchema` — the append-only event row shape.
- Tagged errors: `RunnerNotRegisteredError`, `InvalidApiKeyForRunnerError`, `TaskRunNotClaimableError`.

Tests — 4 cases:
1. `TaskRunSchema` encodes a realistic row; decodes back identically.
2. `TaskRunEventSchema` validates all 7 event-type values.
3. Invalid status rejected.
4. Tagged errors construct + carry fields.

Commit: `feat(runner-protocol): add wire schemas + tagged errors`

### Task 5: `RunnerRpc` group

`packages/runner-protocol/src/groups/runner.ts`:

```ts
export const RunnerRegisterRpc = Rpc.make("runner.register", {
  payload: Schema.Struct({
    hostname: Schema.String,
    capabilities: Schema.Array(CapabilitySchema),
    apiKeyBearer: Schema.String,
  }),
  success: Schema.Struct({
    deviceId: Schema.String,
    sessionToken: Schema.String,
    expiresAt: Schema.DateTimeUtcFromString,
    serverTime: Schema.DateTimeUtcFromString,
  }),
  error: InvalidApiKeyForRunnerError,
});

export const RunnerHeartbeatRpc = Rpc.make("runner.heartbeat", {
  payload: Schema.Struct({
    status: Schema.Literals(["idle", "busy", "draining"]),
  }),
  success: Schema.Struct({ serverTime: Schema.DateTimeUtcFromString }),
  error: RunnerNotRegisteredError,
});

export const RunnerClaimWorkRpc = Rpc.make("runner.claimWork", {
  payload: Schema.Struct({
    capabilityFilter: Schema.Array(CapabilitySchema),
  }),
  success: Schema.NullOr(TaskRunSchema),
  error: RunnerNotRegisteredError,
});

export const RunnerReportEventRpc = Rpc.make("runner.reportEvent", {
  payload: Schema.Struct({
    runId: Schema.String,
    type: TaskRunEventTypeSchema,
    payload: Schema.Unknown,
    seq: Schema.optional(Schema.Number),
  }),
  success: Schema.Void,
  error: Schema.Union([RunnerNotRegisteredError, TaskRunNotClaimableError]),
});

export const RunnerUnregisterRpc = Rpc.make("runner.unregister", {
  payload: Schema.Struct({ reason: Schema.optional(Schema.String) }),
  success: Schema.Void,
  error: RunnerNotRegisteredError,
});

export const RunnerRpc = RpcGroup.make(
  RunnerRegisterRpc,
  RunnerHeartbeatRpc,
  RunnerClaimWorkRpc,
  RunnerReportEventRpc,
  RunnerUnregisterRpc,
);
```

Tests — 3 cases:
1. Group resolves 5 procedures by tag.
2. Streaming flag absent (runner protocol is request/response only).
3. Procedures that require a session token are declared in a re-exported manifest so the server can apply `RunnerSessionMiddleware` correctly.

Commit: `feat(runner-protocol): add RunnerRpc group (5 procedures)`

### Task 6: Public barrel for `@gmacko/runner-protocol`

Re-export everything: schemas, `RunnerRpc`, tagged errors, the session-middleware requirement flag. 1 smoke test already exists from Task 3; add 1 more layer-smoke test (no new layer in this package — it's all types + pure factories — so this test is simpler: just assert the barrel exposes the expected symbols).

Commit: `feat(runner-protocol): finalize @gmacko/runner-protocol public barrel`

### Task 7: Scaffold `@gmacko/runner-base` deps

Same as Task 3 but for `runner-base`. Extra deps beyond standard: `@gmacko/runner-protocol` workspace, `@effect/platform` or whatever provides HTTP client (check what `@gmacko/client` uses — likely `effect/unstable/http`).

1 smoke test (`__gmackoRunnerBasePhase === "6g"`).

Commit: `chore(runner-base): scaffold deps for 6G`

### Task 8: Retry schedule helper

`packages/runner-base/src/retry.ts` — a named exported `retrySchedule` built from `Schedule.exponential + jittered + recurs(5)`.

Tests — 3 cases:
1. First 5 transient failures retried; 6th propagates.
2. Backoff duration grows exponentially (assert via `TestClock` if possible).
3. Jitter is non-zero (assert delay variance across 10 runs).

Commit: `feat(runner-base): add retry schedule helper (exp + jitter + recurs 5)`

### Task 9: Register + heartbeat loop

`packages/runner-base/src/runtime.ts` — core service. Start with the register-then-heartbeat half:

```ts
export class RunnerRuntime extends ServiceMap.Service<RunnerRuntime, {
  readonly start: (opts: StartOptions) => Effect<void, RuntimeStartError, Scope>;
  readonly handle: (capability: string, handler: WorkHandler) => void;  // synchronous registration
}>()("@gmacko/runner-base/RunnerRuntime") {}
```

Internal state: `Ref<{sessionToken, deviceId, handlerRegistry, inFlightFibers, currentStatus}>`. Register once on start; fork a heartbeat fiber (`Effect.repeat(heartbeat(), Schedule.fixed("10 seconds"))`) inside the scope.

Tests — 4 cases using the MockServer harness (scaffolded inline for this task; formalized in Task 12):
1. `start` registers and returns a session token.
2. Heartbeats fire every 10 seconds (verify via TestClock).
3. Transient heartbeat failure retries per schedule, then recovers.
4. Register with invalid API key fails with `InvalidApiKeyForRunnerError`.

Commit: `feat(runner-base): add RunnerRuntime.start with register + heartbeat loop`

### Task 10: Claim + dispatch loop

Add the claim/dispatch half. A fork inside the scope repeats: `claimWork → Some(taskRun) → dispatch to handler → reportEvent*`. Dispatch puts the handler fiber into `inFlightFibers` ref; reports events as the handler emits them; removes from set on completion.

Tests — 3 cases:
1. Happy path: MockServer serves a task with `capability=claude-code`; handler registered for that capability processes it; events flow back.
2. No matching capability → no claim attempt (or claim returns null) — runner stays idle.
3. Handler throws → `reportEvent(type="error")` fires with the error message; task marked `failed` server-side.

Commit: `feat(runner-base): add claim + dispatch loop with WorkHandler registry`

### Task 11: SIGTERM drain

Add scope-based drain semantics. On scope teardown:
1. Transition status to `draining` (heartbeat sends it).
2. Stop the claim loop (no new claims).
3. Wait for `inFlightFibers` set to drain (bounded by a configurable grace period, default 30s).
4. Call `runner.unregister`.

Tests — 2 cases:
1. In-flight handler completes before unregister (verify unregister call happens AFTER handler result).
2. Grace timeout fires if a handler hangs — runtime unregisters anyway + interrupts remaining fibers.

Commit: `feat(runner-base): add SIGTERM drain (status transition + fiber drain + unregister)`

### Task 12: MockServer test harness

`packages/runner-base/src/testing/mock-server.ts` — reusable test harness. Spins up a real in-process RpcServer serving `RunnerRpc` with an in-memory task queue + in-memory device registry. Exposes helpers: `enqueueTask(tr)`, `assertCalls(procedure, n)`, `injectFailure(procedure, times)`.

Tests — 3 cases proving the MockServer itself works:
1. Runner register + heartbeat round-trip.
2. enqueueTask + claim round-trip.
3. Failure injection causes the expected number of errors.

Commit: `test(runner-base): add MockServer harness for runtime integration tests`

### Task 13: End-to-end integration test

`packages/runner-base/src/__tests__/e2e.test.ts` — the full runtime loop: register → 3 heartbeats → claim task → 5 events → SIGTERM → drain → unregister. This is the proof point for 6G's exit criteria.

3 tests:
1. Happy-path end-to-end (the full loop).
2. Retry recovery: inject 2 transient heartbeat failures; assert runtime survives.
3. Drain under SIGTERM: mid-task SIGTERM → task completes → unregister → exit.

Commit: `test(runner-base): add end-to-end integration test (register → drain)`

### Task 14: Public barrel + exit verification + tag

`packages/runner-base/src/index.ts` — re-export `RunnerRuntime`, `layerRunnerRuntime`, `WorkHandler`, retrySchedule, MockServer (under `./testing` subpath), tagged errors, types.

Layer smoke test (1).

Then:
1. `pnpm -r --filter '!./apps/*' typecheck` green.
2. Full test suite ≥ 270 passing. Serial for PGlite-heavy packages.
3. Git tree clean.
4. Tag `phase-6g-complete`.
5. Append "Phase 6G — Completed" section to this plan.
6. Merge to master + push tag.

---

## Open items carried into 6H onboarding

- **Real server-side `runner.*` handlers.** 6K will back these with the `task_runs` + `runner_devices` tables, swapping the MockServer pattern for real DB operations.
- **Priority / affinity for claimWork.** FIFO-by-creation is the MVP; priority queues, capability-weighted fairness land when workloads demand.
- **Reservation leases + zombie detection.** Server-side heartbeat monitoring + automatic re-queue of tasks whose runner stopped heartbeating. Needs 6H realtime plumbing.
- **Encrypted payloads** — `taskRuns.input` / `reportEvent.payload` are plaintext jsonb. Envelope encryption via `@gmacko/secrets` when needed.
- **Long-poll `claimWork`** — current poll model wastes cycles when idle. Long-polling (hold the HTTP response for up to 30s until a task appears) is a perf optimization for later.
- **Runner SDK polish** — the `@gmacko/runner-base` surface today requires callers to hand-build an HTTP client. A `createGmackoRunner({baseURL, apiKey, capabilities, handlers})` one-shot factory is a nice-to-have.

## Convention reinforced

- Each task = RED → GREEN → COMMIT with dedicated subagent.
- Protocol packages own schemas + RpcGroups; runtime packages own loops + SDK composition.
- Retries are always `Schedule.exponential + jittered + recurs(budget)` — never ad-hoc sleeps.
- All long-lived workers live inside `Effect.scoped` so SIGTERM cleanup is automatic.
