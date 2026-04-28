// Phase 6G Tasks 9 + 10 — RunnerRuntime register + heartbeat + claim/dispatch
// tests.
//
// Strategy:
//   - Spin up ONE real Node HTTP server (shared via beforeAll/afterAll) running
//     `RpcServer.layerHttp({ group: RunnerRpc })`. Per-test isolation comes
//     from resetting the in-memory mock state (call counters, failure
//     injection counters) between tests rather than restarting the server —
//     much faster, and the runtime itself is created scoped per test so
//     fibers tear down cleanly.
//   - The Node ↔ WHATWG adapter is the same shape used in the 6F e2e test
//     (`packages/client/src/__tests__/e2e.test.ts`). Task 12 will formalize
//     this into a reusable `MockServer` helper; for Task 9 it lives inline.
//   - The runtime under test calls `runner.register` then forks a heartbeat
//     loop. We verify (1) register success populates state, (2) heartbeats
//     fire on the configured interval (live clock), (3) transient heartbeat
//     failures are retried, (4) register failures surface as
//     `RuntimeStartError`.
//   - Task 10 extends the same harness with `runner.claimWork` and
//     `runner.reportEvent` handlers backed by a per-test queue + recorded
//     events list, exercising the claim → dispatch → emit loop.

import { afterAll, beforeAll, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Duration, Effect, Exit, Layer, Ref } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import {
  RunnerRpc,
  InvalidApiKeyForRunnerError,
  RunnerNotRegisteredError,
  type TaskRunEventType,
  type TaskRunWire,
} from "@gmacko/core/runner-protocol";

import {
  RunnerRuntime,
  RuntimeStartError,
  layerRunnerRuntime,
  type WorkHandler,
} from "../runtime.js";

// --- Mock server state -----------------------------------------------------
//
// Mutable per-test counters/flags. Reset in `beforeEach`. The Effect Refs
// underneath are created once and re-used because the layer that depends on
// them is mounted into the persistent server — but `Ref.set` mutates them
// safely between tests.

interface RecordedEvent {
  readonly runId: string;
  readonly type: TaskRunEventType;
  readonly payload: unknown;
  readonly seq?: number;
}

interface MockState {
  registerCalls: number;
  heartbeatCalls: number;
  claimWorkCalls: number;
  unregisterCalls: number;
  registerShouldFail: boolean;
  heartbeatFailuresRemaining: number;
  // Last heartbeat status the server saw — Task 11's drain test asserts a
  // final `draining` heartbeat is sent before unregister.
  lastHeartbeatStatus: string | null;
  // FIFO queue of tasks the next matching `claimWork` will dequeue (matched
  // by capability filter intersection).
  taskQueue: TaskRunWire[];
  // All `runner.reportEvent` payloads in arrival order. The dispatch loop
  // calls reportEvent once per `emit(...)` plus a terminal status_change /
  // error event, so this is the contract by which Task 10 tests verify
  // "events flowed back".
  reportedEvents: RecordedEvent[];
  // Wall-clock timestamps captured for ordering assertions in Task 11
  // drain tests. Recorded as `Date.now()` at the moment the corresponding
  // mock handler ran.
  unregisterAt: number | null;
  // Map of runId → wall-clock Date.now() of the last reportEvent received
  // for that run. Drain test uses this to assert
  // "terminal handler event arrived before unregister".
  lastReportEventAt: number | null;
}

const initialState = (): MockState => ({
  registerCalls: 0,
  heartbeatCalls: 0,
  claimWorkCalls: 0,
  unregisterCalls: 0,
  registerShouldFail: false,
  heartbeatFailuresRemaining: 0,
  lastHeartbeatStatus: null,
  taskQueue: [],
  reportedEvents: [],
  unregisterAt: null,
  lastReportEventAt: null,
});

// Shared test fixture: build a TaskRunWire with sensible defaults.
const makeTask = (
  id: string,
  capabilitiesRequired: ReadonlyArray<string>,
  input: Record<string, unknown> = {},
): TaskRunWire => ({
  id,
  tenantId: "tenant-test",
  status: "pending",
  capabilitiesRequired,
  claimedByDeviceId: null,
  input,
  result: null,
  errorMessage: null,
  claimedAt: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2026-04-22T00:00:00.000Z"),
  updatedAt: new Date("2026-04-22T00:00:00.000Z"),
});

let mockStateRef: Ref.Ref<MockState>;

// --- Handlers --------------------------------------------------------------
//
// Constructed inside a Layer so they can read/write `mockStateRef` via the
// Effect runtime. Procedures we don't exercise in these tests use
// `Effect.die` so accidental calls fail loudly rather than silently passing.

const STUB_DEVICE_ID = "device-stub-1234";
const STUB_SESSION_TOKEN = "stub-session-token";

const buildHandlersLayer = (ref: Ref.Ref<MockState>) =>
  RunnerRpc.toLayer({
    "runner.register": () =>
      Effect.gen(function* () {
        const state = yield* Ref.get(ref);
        yield* Ref.set(ref, { ...state, registerCalls: state.registerCalls + 1 });
        if (state.registerShouldFail) {
          return yield* Effect.fail(
            new InvalidApiKeyForRunnerError({
              message: "stub register failure",
            }),
          );
        }
        const now = new Date("2026-04-22T00:00:00.000Z");
        const expires = new Date("2026-04-22T01:00:00.000Z");
        return {
          deviceId: STUB_DEVICE_ID,
          sessionToken: STUB_SESSION_TOKEN,
          expiresAt: expires,
          serverTime: now,
        };
      }),

    "runner.heartbeat": ({ status }) =>
      Effect.gen(function* () {
        // Compose all state mutations in a single Ref.update so the call
        // counter and failure counter stay consistent under any future
        // concurrency (today the handlers are serial within one process).
        const previous = yield* Ref.modify(ref, (s) => [
          s,
          {
            ...s,
            heartbeatCalls: s.heartbeatCalls + 1,
            heartbeatFailuresRemaining: Math.max(
              0,
              s.heartbeatFailuresRemaining - 1,
            ),
            lastHeartbeatStatus: status,
          },
        ]);
        if (previous.heartbeatFailuresRemaining > 0) {
          return yield* Effect.fail(
            new RunnerNotRegisteredError({ deviceId: STUB_DEVICE_ID }),
          );
        }
        return { serverTime: new Date("2026-04-22T00:00:01.000Z") };
      }),

    "runner.claimWork": ({ capabilityFilter }) =>
      Effect.gen(function* () {
        // Atomically: increment counter, dequeue the first task whose
        // `capabilitiesRequired` intersects with the runner's filter.
        const dequeued = yield* Ref.modify(ref, (s) => {
          const filterSet = new Set(capabilityFilter);
          const idx = s.taskQueue.findIndex((t) =>
            t.capabilitiesRequired.some((c) => filterSet.has(c)),
          );
          if (idx === -1) {
            return [
              null as TaskRunWire | null,
              { ...s, claimWorkCalls: s.claimWorkCalls + 1 },
            ];
          }
          const next = s.taskQueue[idx]!;
          const remaining = [
            ...s.taskQueue.slice(0, idx),
            ...s.taskQueue.slice(idx + 1),
          ];
          return [
            next,
            {
              ...s,
              claimWorkCalls: s.claimWorkCalls + 1,
              taskQueue: remaining,
            },
          ];
        });
        return dequeued;
      }),

    "runner.reportEvent": (payload) =>
      Effect.gen(function* () {
        yield* Ref.update(ref, (s) => ({
          ...s,
          reportedEvents: [
            ...s.reportedEvents,
            {
              runId: payload.runId,
              type: payload.type,
              payload: payload.payload,
              seq: payload.seq,
            },
          ],
          lastReportEventAt: Date.now(),
        }));
        return undefined;
      }),

    "runner.unregister": () =>
      Effect.gen(function* () {
        yield* Ref.update(ref, (s) => ({
          ...s,
          unregisterCalls: s.unregisterCalls + 1,
          unregisterAt: Date.now(),
        }));
        return undefined;
      }),
  });

// --- Server lifecycle ------------------------------------------------------

let server: Server;
let baseURL: string;
let disposeHandler: (() => Promise<void>) | null = null;

async function readNodeRequestBody(
  req: import("node:http").IncomingMessage,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function buildWebRequest(
  req: import("node:http").IncomingMessage,
  body: Uint8Array,
  origin: string,
): Request {
  const url = new URL(req.url ?? "/", origin);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) {
      for (const entry of v) headers.append(k, entry);
    } else if (typeof v === "string") {
      headers.set(k, v);
    }
  }
  const method = req.method ?? "GET";
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && body.byteLength > 0) {
    init.body = new Blob([new Uint8Array(body)]);
  }
  return new Request(url, init);
}

async function writeWebResponse(
  res: import("node:http").ServerResponse,
  webResp: Response,
): Promise<void> {
  res.statusCode = webResp.status;
  for (const [k, v] of webResp.headers.entries()) {
    res.setHeader(k, v);
  }
  if (!webResp.body) {
    res.end();
    return;
  }
  const reader = webResp.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

beforeAll(async () => {
  // Bootstrap the Ref synchronously: `Effect.runSync(Ref.make(...))` returns
  // the Ref directly. The handlers layer closes over this Ref.
  mockStateRef = Effect.runSync(Ref.make(initialState()));

  const handlersLayer = buildHandlersLayer(mockStateRef);

  const serverLayer = RpcServer.layerHttp({
    group: RunnerRpc,
    path: "/rpc",
    protocol: "http",
  }).pipe(
    Layer.provide(handlersLayer),
    Layer.provide(RpcSerialization.layerJson),
  );

  const { handler, dispose } = HttpRouter.toWebHandler(serverLayer);
  disposeHandler = dispose;

  server = createServer(async (req, res) => {
    try {
      const body = await readNodeRequestBody(req);
      const webReq = buildWebRequest(req, body, "http://127.0.0.1");
      const webResp = await handler(webReq);
      await writeWebResponse(res, webResp);
    } catch (err) {
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          error: "server-adapter-error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  baseURL = `http://127.0.0.1:${addr.port}/rpc`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  if (disposeHandler) {
    await disposeHandler();
  }
});

beforeEach(() => {
  Effect.runSync(Ref.set(mockStateRef, initialState()));
});

// --- Tests -----------------------------------------------------------------

const baseStartOpts = () => ({
  baseURL,
  hostname: "test-runner-host",
  capabilities: ["claude-code"] as const,
  apiKeyBearer: "gmk_test_key",
});

describe("RunnerRuntime register + heartbeat", () => {
  it.live(
    "start registers and stores session, currentStatus is idle",
    () =>
      Effect.gen(function* () {
        const runtime = yield* RunnerRuntime;
        yield* runtime.start({ ...baseStartOpts(), heartbeatInterval: Duration.minutes(10) });

        const status = yield* runtime.currentStatus();
        expect(status).toBe("idle");

        const state = yield* Ref.get(mockStateRef);
        expect(state.registerCalls).toBe(1);
      }).pipe(
        Effect.scoped,
        Effect.provide(layerRunnerRuntime),
      ),
    20_000,
  );

  it.live(
    "heartbeats fire on the configured interval",
    () =>
      Effect.gen(function* () {
        const runtime = yield* RunnerRuntime;
        yield* runtime.start({
          ...baseStartOpts(),
          heartbeatInterval: Duration.millis(100),
        });

        // Wait ~350ms (real time) — expect ≥3 heartbeat calls.
        yield* Effect.sleep(Duration.millis(400));
        const state = yield* Ref.get(mockStateRef);
        expect(state.heartbeatCalls).toBeGreaterThanOrEqual(3);
      }).pipe(
        Effect.scoped,
        Effect.provide(layerRunnerRuntime),
      ),
    20_000,
  );

  it.live(
    "heartbeat retries through transient failures and recovers",
    () =>
      Effect.gen(function* () {
        // Inject 2 transient failures into the heartbeat handler — the retry
        // schedule (5 retries with backoff) should burn through them and
        // continue fine.
        yield* Ref.update(mockStateRef, (s) => ({
          ...s,
          heartbeatFailuresRemaining: 2,
        }));

        const runtime = yield* RunnerRuntime;
        yield* runtime.start({
          ...baseStartOpts(),
          heartbeatInterval: Duration.millis(100),
        });

        // Give enough time for the failures + retries + at least one success.
        yield* Effect.sleep(Duration.millis(1200));

        const state = yield* Ref.get(mockStateRef);
        // After the 2 injected failures are exhausted, subsequent calls
        // succeed. heartbeatCalls counts every attempt; we expect the 2
        // failed ones plus at least one successful one.
        expect(state.heartbeatFailuresRemaining).toBe(0);
        expect(state.heartbeatCalls).toBeGreaterThanOrEqual(3);
      }).pipe(
        Effect.scoped,
        Effect.provide(layerRunnerRuntime),
      ),
    20_000,
  );

  it.live(
    "register failure surfaces as RuntimeStartError",
    () =>
      Effect.gen(function* () {
        yield* Ref.update(mockStateRef, (s) => ({
          ...s,
          registerShouldFail: true,
        }));

        const runtime = yield* RunnerRuntime;
        const result = yield* Effect.exit(
          runtime.start({
            ...baseStartOpts(),
            heartbeatInterval: Duration.minutes(10),
          }),
        );

        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          // Confirm the tagged error surfaces by inspecting the rendered
          // Cause — the Cause walk APIs in beta.43 are verbose and the
          // tag string is sufficient evidence that `RuntimeStartError`
          // (rather than the underlying RPC error) reached the caller.
          const rendered = JSON.stringify(result);
          expect(rendered).toContain("RuntimeStartError");
          expect(rendered).toContain("register failed");
        }
      }).pipe(
        Effect.scoped,
        Effect.provide(layerRunnerRuntime),
      ),
    20_000,
  );
});

// --- Task 10: claim + dispatch loop ----------------------------------------
//
// These tests register a `WorkHandler` *before* `start()`, enqueue tasks via
// the mutable mock state, and assert: handler invocation, event passthrough,
// terminal status_change/error events, and the no-match branch (handler not
// invoked when capabilityFilter doesn't intersect the queued task).
//
// All tests use `it.live` because the claim loop polls in real time. We tune
// `heartbeatInterval` to be effectively dormant during the window so the
// heartbeat noise doesn't crowd the test logs (heartbeats are exercised in
// the Task 9 tests above).

describe("RunnerRuntime claim + dispatch", () => {
  it.live(
    "claims matching task, dispatches to handler, events flow back",
    () =>
      Effect.gen(function* () {
        // Enqueue one task before starting the runtime so the first claim
        // tick picks it up.
        const task = makeTask("run-happy-1", ["claude-code"], {
          prompt: "do the thing",
        });
        yield* Ref.update(mockStateRef, (s) => ({
          ...s,
          taskQueue: [...s.taskQueue, task],
        }));

        // Capture each invocation of the handler so we can assert it ran
        // exactly once with the expected payload. We can't read this from
        // the runtime side, so it lives in a closure variable — fine for
        // a vitest test, since handler runs after `Effect.scoped` and the
        // test body sees the mutated array.
        const invocations: Array<{
          runId: string;
          capability: string;
          input: unknown;
        }> = [];

        const handler: WorkHandler = ({ runId, capability, input, emit }) =>
          Effect.gen(function* () {
            invocations.push({ runId, capability, input });
            yield* emit({
              type: "stdout",
              payload: { text: "hello from handler" },
              seq: 1,
            });
          });

        const runtime = yield* RunnerRuntime;
        yield* runtime.handle("claude-code", handler);
        yield* runtime.start({
          ...baseStartOpts(),
          heartbeatInterval: Duration.minutes(10),
          claimInterval: Duration.millis(100),
        });

        yield* Effect.sleep(Duration.millis(500));

        // Handler should have been invoked once with the queued task.
        expect(invocations.length).toBe(1);
        expect(invocations[0]?.runId).toBe("run-happy-1");
        expect(invocations[0]?.capability).toBe("claude-code");
        expect(invocations[0]?.input).toEqual({ prompt: "do the thing" });

        const state = yield* Ref.get(mockStateRef);

        // We expect at least 2 reportEvent calls: 1 from handler.emit + 1
        // terminal status_change → completed.
        expect(state.reportedEvents.length).toBeGreaterThanOrEqual(2);

        const stdoutEvent = state.reportedEvents.find(
          (e) => e.type === "stdout",
        );
        expect(stdoutEvent).toBeDefined();
        expect(stdoutEvent?.runId).toBe("run-happy-1");

        const completedEvent = state.reportedEvents.find(
          (e) =>
            e.type === "status_change" &&
            (e.payload as { status?: string } | null)?.status === "completed",
        );
        expect(completedEvent).toBeDefined();
        expect(completedEvent?.runId).toBe("run-happy-1");
      }).pipe(
        Effect.scoped,
        Effect.provide(layerRunnerRuntime),
      ),
    20_000,
  );

  it.live(
    "task with no matching capability is not claimed; handler not invoked",
    () =>
      Effect.gen(function* () {
        // Queue a task that requires "claude-code" but only register a
        // handler for "unrelated". The runner sends ["unrelated"] as the
        // capabilityFilter — the mock won't dequeue the claude-code task.
        const task = makeTask("run-nomatch-1", ["claude-code"]);
        yield* Ref.update(mockStateRef, (s) => ({
          ...s,
          taskQueue: [...s.taskQueue, task],
        }));

        let invoked = false;
        const handler: WorkHandler = () =>
          Effect.sync(() => {
            invoked = true;
          });

        const runtime = yield* RunnerRuntime;
        yield* runtime.handle("unrelated", handler);
        yield* runtime.start({
          ...baseStartOpts(),
          heartbeatInterval: Duration.minutes(10),
          claimInterval: Duration.millis(100),
        });

        yield* Effect.sleep(Duration.millis(400));

        expect(invoked).toBe(false);
        const state = yield* Ref.get(mockStateRef);
        // Runner did poll for work — but the mock returned null every time
        // because nothing in the queue intersected with ["unrelated"].
        expect(state.claimWorkCalls).toBeGreaterThanOrEqual(1);
        // Task is still in the queue (not dequeued).
        expect(state.taskQueue.length).toBe(1);
        // No events ever reported.
        expect(state.reportedEvents.length).toBe(0);
      }).pipe(
        Effect.scoped,
        Effect.provide(layerRunnerRuntime),
      ),
    20_000,
  );

  it.live(
    "handler failure reports an error event with the message",
    () =>
      Effect.gen(function* () {
        const task = makeTask("run-boom-1", ["claude-code"]);
        yield* Ref.update(mockStateRef, (s) => ({
          ...s,
          taskQueue: [...s.taskQueue, task],
        }));

        const handler: WorkHandler = () =>
          Effect.fail(new Error("boom"));

        const runtime = yield* RunnerRuntime;
        yield* runtime.handle("claude-code", handler);
        yield* runtime.start({
          ...baseStartOpts(),
          heartbeatInterval: Duration.minutes(10),
          claimInterval: Duration.millis(100),
        });

        yield* Effect.sleep(Duration.millis(500));

        const state = yield* Ref.get(mockStateRef);
        const errorEvents = state.reportedEvents.filter(
          (e) => e.type === "error",
        );
        expect(errorEvents.length).toBeGreaterThanOrEqual(1);
        const first = errorEvents[0]!;
        expect(first.runId).toBe("run-boom-1");
        const rendered = JSON.stringify(first.payload);
        expect(rendered).toContain("boom");
      }).pipe(
        Effect.scoped,
        Effect.provide(layerRunnerRuntime),
      ),
    20_000,
  );
});

// --- Task 11: SIGTERM drain ------------------------------------------------
//
// Drain is implemented via `Scope.addFinalizer` registered inside `start()`.
// When the caller's scope closes (which is what `Effect.scoped` does at the
// end of an effect, mirroring SIGTERM in production where a signal handler
// triggers scope teardown), the finalizer:
//   1. Transitions status → draining (stops new claims).
//   2. Sends a final draining heartbeat (best-effort).
//   3. Waits for `inFlightFibers` to drain, bounded by `gracePeriodMs`
//      (default 30s); past grace, force-interrupts remaining fibers.
//   4. Calls `runner.unregister`.
//
// Both tests run a `runtime.start` inside an *inner* `Effect.scoped` so we
// can assert post-finalizer state from the *outer* effect after the inner
// scope has fully torn down. The mock records timestamps for ordering
// assertions ("handler completion happened before unregister") and counts
// unregister calls.

describe("RunnerRuntime SIGTERM drain", () => {
  it.live(
    "in-flight handler completes before unregister",
    () =>
      Effect.gen(function* () {
        const task = makeTask("run-drain-happy", ["claude-code"]);
        yield* Ref.update(mockStateRef, (s) => ({
          ...s,
          taskQueue: [...s.taskQueue, task],
        }));

        // Handler sleeps for 200ms then emits a terminal-ish event. The
        // drain finalizer must wait for this to finish before unregistering.
        const handler: WorkHandler = ({ runId, emit }) =>
          Effect.gen(function* () {
            yield* Effect.sleep(Duration.millis(200));
            yield* emit({
              type: "stdout",
              payload: { text: `done-${runId}` },
            });
          });

        // Inner-scoped block: when this returns, the scope unwinds and the
        // drain finalizer fires. We give the claim loop ~150ms to pick up
        // the task before we exit the inner scope, ensuring the handler is
        // already in-flight when drain begins.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* RunnerRuntime;
            yield* runtime.handle("claude-code", handler);
            yield* runtime.start({
              ...baseStartOpts(),
              heartbeatInterval: Duration.minutes(10),
              claimInterval: Duration.millis(50),
            });
            // Wait for the claim to land but exit *before* the handler's
            // 200ms sleep elapses — drain must wait for it.
            yield* Effect.sleep(Duration.millis(120));
          }).pipe(Effect.provide(layerRunnerRuntime)),
        );

        const state = yield* Ref.get(mockStateRef);

        // Unregister was called exactly once.
        expect(state.unregisterCalls).toBe(1);

        // Handler's stdout event arrived before unregister.
        const stdoutEvent = state.reportedEvents.find(
          (e) => e.runId === "run-drain-happy" && e.type === "stdout",
        );
        expect(stdoutEvent).toBeDefined();
        expect(state.lastReportEventAt).not.toBeNull();
        expect(state.unregisterAt).not.toBeNull();
        expect(state.unregisterAt!).toBeGreaterThanOrEqual(
          state.lastReportEventAt!,
        );

        // A draining heartbeat was sent before unregister (drain step 2).
        expect(state.lastHeartbeatStatus).toBe("draining");
      }).pipe(Effect.scoped),
    20_000,
  );

  it.live(
    "grace timeout fires when handler hangs; runtime unregisters anyway",
    () =>
      Effect.gen(function* () {
        const task = makeTask("run-drain-hang", ["claude-code"]);
        yield* Ref.update(mockStateRef, (s) => ({
          ...s,
          taskQueue: [...s.taskQueue, task],
        }));

        // Handler hangs for 5 seconds — way longer than the 100ms grace
        // we configure below. Drain must give up after grace and force-
        // interrupt the fiber, then call unregister.
        let interrupted = false;
        const handler: WorkHandler = () =>
          Effect.gen(function* () {
            yield* Effect.sleep(Duration.seconds(5));
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true;
              }),
            ),
          );

        const startMs = Date.now();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* RunnerRuntime;
            yield* runtime.handle("claude-code", handler);
            yield* runtime.start({
              ...baseStartOpts(),
              heartbeatInterval: Duration.minutes(10),
              claimInterval: Duration.millis(50),
              gracePeriodMs: Duration.millis(100),
            });
            yield* Effect.sleep(Duration.millis(120));
          }).pipe(Effect.provide(layerRunnerRuntime)),
        );
        const elapsedMs = Date.now() - startMs;

        // Whole sequence (start + claim + grace + interrupt + unregister)
        // wraps up well under 1 second — proves we didn't wait the full 5s
        // handler sleep.
        expect(elapsedMs).toBeLessThan(1500);

        const state = yield* Ref.get(mockStateRef);
        // Unregister still happened despite the hung handler.
        expect(state.unregisterCalls).toBe(1);
        // Handler fiber was force-interrupted after grace expired.
        expect(interrupted).toBe(true);
      }).pipe(Effect.scoped),
    20_000,
  );
});
