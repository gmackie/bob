// Integration tests for `RunnerSessionMiddleware` — the `RpcMiddleware.Service`
// that reads `X-Runner-Session` and provides a `RunnerSession` context.
//
// Mirrors the `rpc-middleware.test.ts` shape: in-process RPC round-trip via
// `RpcTest.makeClient`, with an `HttpServerRequest` synthesized from a WHATWG
// `Request` (so `HttpServerRequest` is ambient at server-build time, which
// `RpcServer.makeNoSerialization` captures via `Effect.services()`).
import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Rpc, RpcGroup, RpcTest } from "effect/unstable/rpc";
import { HttpServerRequest } from "effect/unstable/http";

import { UnauthorizedError } from "@gmacko/rpc/errors";
import { RunnerSession } from "@gmacko/rpc/context";

import {
  InvalidRunnerSessionError,
  RunnerSessions,
  layerRunnerSessions,
} from "../runner-sessions.js";
import {
  RunnerSessionMiddleware,
  layerRunnerSessionMiddleware,
} from "../runner-session-middleware.js";

const GOOD_KEY = "0123456789abcdef0123456789abcdef"; // exactly 32 chars

const RunnerSessionWireSchema = Schema.Struct({
  deviceId: Schema.String,
  tenantId: Schema.String,
});

const WhoAmIRunnerRpc = Rpc.make("test.runner.whoAmI", {
  payload: Schema.Void,
  success: RunnerSessionWireSchema,
  error: Schema.Union([UnauthorizedError, InvalidRunnerSessionError]),
});

const TestGroup = RpcGroup.make(WhoAmIRunnerRpc).middleware(
  RunnerSessionMiddleware,
);

const handlersLayer = TestGroup.toLayer({
  "test.runner.whoAmI": () =>
    Effect.gen(function* () {
      const session = yield* RunnerSession.asEffect();
      return { deviceId: session.deviceId, tenantId: session.tenantId };
    }),
});

const httpRequestLayer = (init: {
  readonly xRunnerSession?: string;
}): Layer.Layer<HttpServerRequest.HttpServerRequest> => {
  const headers: Record<string, string> = {};
  if (init.xRunnerSession) headers["x-runner-session"] = init.xRunnerSession;
  const req = HttpServerRequest.fromWeb(
    new Request("http://test.local/rpc", { headers }),
  );
  return Layer.succeed(HttpServerRequest.HttpServerRequest, req);
};

const fullLayer = (
  reqInit: Parameters<typeof httpRequestLayer>[0],
): Layer.Layer<
  Rpc.ToHandler<RpcGroup.Rpcs<typeof TestGroup>> | RunnerSessionMiddleware,
  never,
  never
> => {
  const middlewareLayer = Layer.provide(
    layerRunnerSessionMiddleware,
    layerRunnerSessions,
  );
  return Layer.mergeAll(
    handlersLayer,
    middlewareLayer,
    httpRequestLayer(reqInit),
  ) as unknown as Layer.Layer<
    Rpc.ToHandler<RpcGroup.Rpcs<typeof TestGroup>> | RunnerSessionMiddleware,
    never,
    never
  >;
};

describe("@gmacko/auth RunnerSessionMiddleware", () => {
  beforeEach(() => {
    process.env.GMACKO_SECRET_ENCRYPTION_KEY = GOOD_KEY;
  });

  afterEach(() => {
    delete process.env.GMACKO_SECRET_ENCRYPTION_KEY;
  });

  it.effect("happy path: valid X-Runner-Session populates RunnerSession", () => {
    // Mint a token outside the Effect pipeline — the minter is pure given
    // the env var, so we use Effect.runSync against a scoped `layerRunnerSessions`
    // up-front. The RPC pipeline then runs with that token in the header.
    const minted = Effect.runSync(
      Effect.gen(function* () {
        const sessions = yield* RunnerSessions;
        return yield* sessions.mint({
          deviceId: "device-happy",
          tenantId: "tenant-happy",
        });
      }).pipe(Effect.provide(layerRunnerSessions)),
    );

    return Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TestGroup);
      const result = yield* client["test.runner.whoAmI"]();
      expect(result).toEqual({
        deviceId: "device-happy",
        tenantId: "tenant-happy",
      });
    }).pipe(Effect.provide(fullLayer({ xRunnerSession: minted.token })));
  });

  it.effect("missing X-Runner-Session → UnauthorizedError on error channel", () =>
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TestGroup);
      const caught = yield* Effect.flip(client["test.runner.whoAmI"]());
      expect(caught).toBeInstanceOf(UnauthorizedError);
      expect((caught as UnauthorizedError).message).toContain(
        "X-Runner-Session",
      );
    }).pipe(Effect.provide(fullLayer({}))),
  );

  it.effect("tampered signature → InvalidRunnerSessionError on error channel", () => {
    const minted = Effect.runSync(
      Effect.gen(function* () {
        const sessions = yield* RunnerSessions;
        return yield* sessions.mint({
          deviceId: "device-tamper",
          tenantId: "tenant-tamper",
        });
      }).pipe(Effect.provide(layerRunnerSessions)),
    );
    const [payloadB64, signature] = minted.token.split(".");
    const flipped =
      (signature![0] === "A" ? "B" : "A") + signature!.slice(1);
    const tamperedToken = `${payloadB64}.${flipped}`;

    return Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TestGroup);
      const caught = yield* Effect.flip(client["test.runner.whoAmI"]());
      expect(caught).toBeInstanceOf(InvalidRunnerSessionError);
      expect((caught as InvalidRunnerSessionError).reason).toBe("signature");
    }).pipe(Effect.provide(fullLayer({ xRunnerSession: tamperedToken })));
  });
});
