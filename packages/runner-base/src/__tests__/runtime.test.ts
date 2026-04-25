// Phase 6G Task 9 — RunnerRuntime register + heartbeat tests.
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
} from "@gmacko/runner-protocol";

import {
  RunnerRuntime,
  RuntimeStartError,
  layerRunnerRuntime,
} from "../runtime.js";

// --- Mock server state -----------------------------------------------------
//
// Mutable per-test counters/flags. Reset in `beforeEach`. The Effect Refs
// underneath are created once and re-used because the layer that depends on
// them is mounted into the persistent server — but `Ref.set` mutates them
// safely between tests.

interface MockState {
  registerCalls: number;
  heartbeatCalls: number;
  registerShouldFail: boolean;
  heartbeatFailuresRemaining: number;
}

const initialState = (): MockState => ({
  registerCalls: 0,
  heartbeatCalls: 0,
  registerShouldFail: false,
  heartbeatFailuresRemaining: 0,
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

    "runner.heartbeat": () =>
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
          },
        ]);
        if (previous.heartbeatFailuresRemaining > 0) {
          return yield* Effect.fail(
            new RunnerNotRegisteredError({ deviceId: STUB_DEVICE_ID }),
          );
        }
        return { serverTime: new Date("2026-04-22T00:00:01.000Z") };
      }),

    "runner.claimWork": () => Effect.die("claimWork not used in Task 9 tests"),
    "runner.reportEvent": () =>
      Effect.die("reportEvent not used in Task 9 tests"),
    "runner.unregister": () =>
      Effect.die("unregister not used in Task 9 tests"),
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
