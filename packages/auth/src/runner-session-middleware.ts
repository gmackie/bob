// RPC-layer middleware for runner auth. Sibling of `AuthMiddleware`:
//   - Reads the `X-Runner-Session` header from the request-scoped
//     `HttpServerRequest` service.
//   - Validates the opaque HMAC-signed token via `RunnerSessions.validate`.
//   - Provides the decoded `{deviceId, tenantId}` to the handler as
//     `RunnerSession` (from `@gmacko/rpc/context`).
//
// Error channel:
//   - Missing `X-Runner-Session` header → `UnauthorizedError`.
//   - Invalid/expired/tampered token → `InvalidRunnerSessionError` (with
//     `reason` tag surfacing the failure mode).
//
// Config shape note (verified against
// `effect/unstable/rpc/RpcMiddleware.d.ts:176`):
//   - Config keys are `requires` / `provides` / `clientError`.
//   - Error schema goes on the SECOND options object as `error: ...`, NOT
//     inside Config. Mirrors the `AuthMiddleware` wrapper in
//     `./rpc-middleware.ts`.
//   - `HttpServerRequest` is listed in `requires` because the middleware
//     closure reads it per-request; its data is only bound after the
//     transport injects it, so the Layer itself doesn't consume it.
import { Effect, Layer, Schema } from "effect";
import { RpcMiddleware } from "effect/unstable/rpc";
import { HttpServerRequest } from "effect/unstable/http";

import { RunnerSession } from "@gmacko/rpc/context";
import { UnauthorizedError } from "@gmacko/rpc/errors";

import { InvalidRunnerSessionError, RunnerSessions } from "./runner-sessions.js";

export class RunnerSessionMiddleware extends RpcMiddleware.Service<
  RunnerSessionMiddleware,
  {
    readonly provides: typeof RunnerSession;
    readonly requires: HttpServerRequest.HttpServerRequest;
  }
>()("@gmacko/auth/RunnerSessionMiddleware", {
  error: Schema.Union([UnauthorizedError, InvalidRunnerSessionError]),
}) {}

/**
 * Layer that implements `RunnerSessionMiddleware`. The closure captures
 * the `RunnerSessions` service at build time; at call time it reads
 * `HttpServerRequest` (ambient per request) and pulls the header value.
 *
 * Header name is lowercased for `HttpServerRequest.headers` (Node/undici
 * normalize incoming header names to lowercase) but we also defensively
 * check the mixed-case variant for environments that surface the raw
 * header line.
 */
export const layerRunnerSessionMiddleware: Layer.Layer<
  RunnerSessionMiddleware,
  never,
  RunnerSessions
> = Layer.effect(RunnerSessionMiddleware)(
  Effect.gen(function* () {
    const sessions = yield* RunnerSessions.asEffect();

    return (effect) =>
      Effect.gen(function* () {
        const httpReq = yield* HttpServerRequest.HttpServerRequest;
        const headers = httpReq.headers as unknown as Record<string, string>;
        const token =
          headers["x-runner-session"] ?? headers["X-Runner-Session"];
        if (!token) {
          return yield* Effect.fail(
            new UnauthorizedError({
              message: "Missing X-Runner-Session header",
            }),
          );
        }
        const claims = yield* sessions.validate(token);
        return yield* effect.pipe(
          Effect.provideService(RunnerSession, claims),
        );
      });
  }),
);
