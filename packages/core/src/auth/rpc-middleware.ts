// RPC-layer middleware: wraps the plain-function `resolveCurrentUser` from
// `./middleware.ts` in an `RpcMiddleware.Service` so contract procedures can
// declare the middleware and automatically receive `CurrentUser`.
//
// Why the wrapper is thin: `resolveCurrentUser` already encapsulates the
// credential-extraction / tenant-resolution logic and is covered by 9 unit
// tests. This file is purely the glue that translates from the RPC HTTP
// transport's ambient `HttpServerRequest` service into the `AuthRequest`
// shape the plain function consumes, then provides `CurrentUser` to the
// wrapped effect.
//
// Design notes (cross-referenced in `./middleware.ts`):
//   - `RpcMiddleware.Service<Self, Config>()(Name, opts?)`: Config is
//     `{ requires?, provides?, clientError? }`; the error schema goes on
//     the second options object as `{ error?, requiredForClient? }`. There
//     is NO `failure` key anywhere in the API surface.
//   - The middleware function shape is
//     `(effect, options) => Effect<SuccessValue, E, Requires | Scope>` —
//     `SuccessValue` is an opaque unique-symbol brand; we never materialize
//     it, we just forward the wrapped effect with `CurrentUser` provided.
//   - `HttpServerRequest.cookies` lives on the `HttpServerRequest` service,
//     not on the middleware `options.headers` parameter; the middleware
//     must therefore inject `HttpServerRequest` and is declared as such in
//     `requires`.
import { Effect, Layer, Schema } from "effect";
import { RpcMiddleware } from "effect/unstable/rpc";
import { HttpServerRequest } from "effect/unstable/http";

import { CurrentUser } from "@gmacko/rpc/context";
import { UnauthorizedError } from "@gmacko/rpc/errors";

import { ApiKeys } from "./api-keys.js";
import { Sessions } from "./sessions.js";
import { Tenancy, TenantNotSelectedError } from "./tenancy.js";
import { resolveCurrentUser, type AuthRequest } from "./middleware.js";

/**
 * RPC middleware service that populates `CurrentUser` from HTTP headers +
 * cookies. Procedures opt in by having the middleware attached to their
 * `RpcGroup` (via `RpcGroup.make(...).middleware(AuthMiddleware)`); the
 * group machinery then makes `CurrentUser` available to the handler and
 * routes `UnauthorizedError | TenantNotSelectedError` through the RPC
 * error channel.
 *
 * Config keys confirmed against
 * `effect/unstable/rpc/RpcMiddleware.d.ts:176`:
 *   - `provides: typeof CurrentUser` — the service this middleware injects
 *   - `requires: typeof HttpServerRequest.HttpServerRequest` — services the
 *     middleware itself consumes (beyond whatever its Layer resolves).
 *     `HttpServerRequest` is NOT consumed by our Layer because it's
 *     request-scoped and only exists after the transport binds it; the
 *     middleware closure reads it at call time.
 *
 * The second call receives `error` as a Schema (union of the tagged errors
 * the middleware can fail with).
 */
export class AuthMiddleware extends RpcMiddleware.Service<
  AuthMiddleware,
  {
    readonly provides: typeof CurrentUser;
    readonly requires: HttpServerRequest.HttpServerRequest;
  }
>()("@gmacko/auth/AuthMiddleware", {
  error: Schema.Union([UnauthorizedError, TenantNotSelectedError]),
}) {}

/**
 * Layer that implements `AuthMiddleware`. The closure captures the auth
 * services (`Sessions | ApiKeys | Tenancy`); at call time it reads the
 * request-scoped `HttpServerRequest` service, builds an `AuthRequest`, and
 * delegates to `resolveCurrentUser`. The returned user is injected into
 * the wrapped effect via `Effect.provideService(CurrentUser, user)`.
 */
export const layerAuthMiddleware: Layer.Layer<
  AuthMiddleware,
  never,
  Sessions | ApiKeys | Tenancy
> = Layer.effect(AuthMiddleware)(
  Effect.gen(function* () {
    const sessions = yield* Sessions.asEffect();
    const apiKeys = yield* ApiKeys.asEffect();
    const tenancy = yield* Tenancy.asEffect();

    // The middleware handler. Receives the downstream effect (opaquely
    // typed over SuccessValue) and the transport-provided options. We do
    // not unpack the options.headers ourselves — `HttpServerRequest` is
    // the canonical source because it also carries parsed cookies.
    return (effect) =>
      Effect.gen(function* () {
        const httpReq = yield* HttpServerRequest.HttpServerRequest;
        const authReq: AuthRequest = {
          headers: httpReq.headers as unknown as Record<string, string>,
          cookies: httpReq.cookies as Record<string, string>,
        };
        const user = yield* resolveCurrentUser(authReq).pipe(
          // The plain function requires the three services from ambient
          // context; provide them from the closure so the middleware's
          // `requires` surface stays at `HttpServerRequest` only (the rest
          // are satisfied by this Layer's dependencies, not per-request).
          Effect.provideService(Sessions, sessions),
          Effect.provideService(ApiKeys, apiKeys),
          Effect.provideService(Tenancy, tenancy),
        );
        return yield* effect.pipe(Effect.provideService(CurrentUser, user));
      });
  }),
);
