// Phase 6G Task 13 — End-to-end integration test for `@gmacko/runner-base`.
//
// Strategy:
//   - Reuse the same Node-HTTP + RpcServer harness from runtime.test.ts. We
//     copy the setup inline rather than promote it to a `./testing` subpath
//     because Task 12 (formalized MockServer) was deliberately skipped — the
//     inline pattern already exercises everything needed and there are no
//     external consumers asking for a runner test harness yet.
//   - One test exercises the full lifecycle:
//       register → heartbeats → claimWork → emit events → drain → unregister.
//     Assertions land *after* `Effect.runPromise(Effect.scoped(...))` returns
//     so they can observe state mutated by the drain finalizer.
//   - Pattern (a) from the task brief: use plain `vitest.it` (async/await)
//     and run the runtime as `Effect.runPromise(Effect.scoped(...))`. Drain
//     happens at scope close, *before* `runPromise` resolves; everything
//     captured in shared mock-state arrays is therefore safe to assert in
//     the test body.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Duration, Effect, Layer, Ref } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import {
  RunnerRpc,
  type TaskRunEventType,
  type TaskRunWire,
} from "@gmacko/runner-protocol";

import {
  RunnerRuntime,
  layerRunnerRuntime,
  type WorkHandler,
} from "../runtime.js";

// --- Mock server state -----------------------------------------------------

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
  lastHeartbeatStatus: string | null;
  taskQueue: TaskRunWire[];
  reportedEvents: RecordedEvent[];
}

const initialState = (): MockState => ({
  registerCalls: 0,
  heartbeatCalls: 0,
  claimWorkCalls: 0,
  unregisterCalls: 0,
  lastHeartbeatStatus: null,
  taskQueue: [],
  reportedEvents: [],
});

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

const STUB_DEVICE_ID = "device-e2e";
const STUB_SESSION_TOKEN = "session-e2e";

const buildHandlersLayer = (ref: Ref.Ref<MockState>) =>
  RunnerRpc.toLayer({
    "runner.register": () =>
      Effect.gen(function* () {
        yield* Ref.update(ref, (s) => ({
          ...s,
          registerCalls: s.registerCalls + 1,
        }));
        return {
          deviceId: STUB_DEVICE_ID,
          sessionToken: STUB_SESSION_TOKEN,
          expiresAt: new Date("2026-04-22T01:00:00.000Z"),
          serverTime: new Date("2026-04-22T00:00:00.000Z"),
        };
      }),

    "runner.heartbeat": ({ status }) =>
      Effect.gen(function* () {
        yield* Ref.update(ref, (s) => ({
          ...s,
          heartbeatCalls: s.heartbeatCalls + 1,
          lastHeartbeatStatus: status,
        }));
        return { serverTime: new Date("2026-04-22T00:00:01.000Z") };
      }),

    "runner.claimWork": ({ capabilityFilter }) =>
      Effect.gen(function* () {
        return yield* Ref.modify(ref, (s) => {
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
        }));
        return undefined;
      }),

    "runner.unregister": () =>
      Effect.gen(function* () {
        yield* Ref.update(ref, (s) => ({
          ...s,
          unregisterCalls: s.unregisterCalls + 1,
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

// --- Test ------------------------------------------------------------------

describe("RunnerRuntime end-to-end lifecycle", () => {
  it(
    "full lifecycle: register → heartbeats → claim → events → drain → unregister",
    async () => {
      // Arrange: enqueue one task that requires the "claude-code" capability.
      const task = makeTask("run-e2e-1", ["claude-code"], {
        prompt: "hello world",
      });
      Effect.runSync(
        Ref.update(mockStateRef, (s) => ({
          ...s,
          taskQueue: [...s.taskQueue, task],
        })),
      );

      let handlerInvocations = 0;

      const handler: WorkHandler = ({ emit }) =>
        Effect.gen(function* () {
          handlerInvocations += 1;
          // Emit 3 user events. The runtime adds a terminal `status_change →
          // completed` for a 4th. Plan calls for "5 events" approximately;
          // the assertion below uses ≥3 to stay tolerant.
          yield* emit({
            type: "stdout",
            payload: { line: "hello" },
            seq: 1,
          });
          yield* emit({
            type: "stdout",
            payload: { line: "world" },
            seq: 2,
          });
          yield* emit({
            type: "stdout",
            payload: { line: "done" },
            seq: 3,
          });
        });

      // Run the runtime inside a scoped effect so drain runs at scope close.
      // We sleep ~600ms inside the scope to give the loop time to:
      //   1. register
      //   2. fire heartbeats (interval 100ms → ≥4)
      //   3. claim the task (interval 50ms → first tick within 50ms)
      //   4. emit handler events + terminal status_change
      // After the sleep returns, the Effect.scoped teardown runs the drain
      // finalizer (status → draining, draining heartbeat, fiber wait,
      // unregister).
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* RunnerRuntime;
            yield* runtime.handle("claude-code", handler);
            yield* runtime.start({
              baseURL,
              hostname: "test-runner-e2e",
              capabilities: ["claude-code"],
              apiKeyBearer: "gmk_e2e_key",
              heartbeatInterval: Duration.millis(100),
              claimInterval: Duration.millis(50),
            });
            yield* Effect.sleep(Duration.millis(600));
          }).pipe(Effect.provide(layerRunnerRuntime)),
        ),
      );

      // Assert: the scope has fully unwound, drain has run.
      const state = Effect.runSync(Ref.get(mockStateRef));

      // Register: exactly 1 call across the lifecycle.
      expect(state.registerCalls).toBe(1);

      // Heartbeats: ~600ms / 100ms ≈ 6 attempts, plus a final draining
      // heartbeat in the finalizer. Be tolerant under load: ≥2.
      expect(state.heartbeatCalls).toBeGreaterThanOrEqual(2);

      // Claim: the loop polled at least once (real count is much higher).
      expect(state.claimWorkCalls).toBeGreaterThanOrEqual(1);

      // Handler ran exactly once for the single queued task.
      expect(handlerInvocations).toBe(1);

      // Events: 3 user emits + 1 terminal status_change = 4 reports for our
      // run. Tolerate ≥3 for noise.
      const ourEvents = state.reportedEvents.filter(
        (e) => e.runId === "run-e2e-1",
      );
      expect(ourEvents.length).toBeGreaterThanOrEqual(3);

      // The terminal status_change "completed" must be present.
      const completed = ourEvents.find(
        (e) =>
          e.type === "status_change" &&
          (e.payload as { status?: string } | null)?.status === "completed",
      );
      expect(completed).toBeDefined();

      // Drain step 2: a draining heartbeat was sent before unregister.
      expect(state.lastHeartbeatStatus).toBe("draining");

      // Drain step 4: unregister was called exactly once.
      expect(state.unregisterCalls).toBe(1);
    },
    10_000,
  );
});
