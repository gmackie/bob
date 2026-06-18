// Auth middleware for resolving `CurrentUser` from an HTTP-like request.
//
// APPROACH: plain functions (fallback path) rather than
// `RpcMiddleware.ServiceClass`.
//
// Rationale — from `node_modules/effect/dist/unstable/rpc/RpcMiddleware.d.ts`:
//
//   1. The public constructor is `RpcMiddleware.Service<Self, Config>()(Name, opts)`
//      which returns a `ServiceClass<Self, Name, Provides, E, ClientError,
//      Requires, RequiredForClient>`. The generic surface is substantial and
//      the runtime shape the middleware receives is an `Effect<SuccessValue, ...>`
//      — `SuccessValue` is an intentionally-opaque unique-symbol type. Unit-
//      testing the middleware in isolation means forging that opaque type.
//   2. The middleware's options object exposes `headers: Headers` but NOT
//      cookies. Cookies on the wire sit on `HttpServerRequest.cookies`
//      (effect/http), which is a separate service injected by the HTTP layer
//      that wraps RPC. So a cookie-aware middleware needs *both* services.
//   3. Wiring an RpcMiddleware requires a live RPC server + group to attach
//      it to a procedure; unit tests would either need to stand up a full
//      RpcServer or reach into `SuccessValue` with type casts.
//
// The plain-function path keeps the request-shape decision explicit (we take
// the exact fields we need: `headers` + `cookies`) and is trivially wrappable
// by whatever transport layer ends up hosting it.
//
// TODO(phase-6j): wrap `resolveCurrentUser` / `provideCurrentUser` in an
// `RpcMiddleware.Service<AuthMiddleware>()` during app wiring. The outer HTTP
// layer will read `HttpServerRequest.cookies` + middleware `headers` and
// assemble the `AuthRequest` shape below before calling into this module.
import { Effect } from "effect";

import { CurrentUser, type CurrentUserShape } from "@gmacko/core/rpc/context";
import { UnauthorizedError } from "@gmacko/core/rpc/errors";

import { ApiKeys } from "./api-keys.js";
import { Sessions } from "./sessions.js";
import {
  Tenancy,
  TenantNotSelectedError,
  type Membership,
} from "./tenancy.js";
import type { TenantId, UserId } from "@gmacko/core/validators";

/**
 * Default cookie name used by better-auth for session tokens.
 * Source: `better-auth@1.4.0-beta.9/dist/shared/better-auth.*.mjs` →
 * `getSessionCookie` default `cookiePrefix: "better-auth."` +
 * `cookieName: "session_token"`. We accept the plain `"session"` name as a
 * secondary alias to keep the door open for custom deployments.
 */
export const DEFAULT_SESSION_COOKIE_NAME = "better-auth.session_token" as const;

/**
 * Minimal request shape the middleware reads. Kept structural so both
 * `HttpServerRequest` (`{ headers: Headers, cookies: ReadonlyRecord<string,
 * string> }`) and a WHATWG `Request` (post-`req.headers.get` unpacking) can
 * satisfy it.
 */
export interface AuthRequest {
  readonly headers: Headers | Record<string, string>;
  readonly cookies?: Record<string, string> | ReadonlyMap<string, string>;
}

const readHeader = (
  headers: AuthRequest["headers"],
  name: string,
): string | null => {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  // Node-style record: match case-insensitively.
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = (headers as Record<string, string>)[key];
      return typeof v === "string" ? v : null;
    }
  }
  return null;
};

/**
 * Convert {@link AuthRequest.headers} (which may be a `Headers` instance or a
 * plain `Record<string, string>`) into a real `Headers` object. Used by the
 * cookie auth path to hand the raw request headers to
 * `Sessions.validateRequest`, which delegates to better-auth's
 * signature-aware `auth.api.getSession({ headers })`.
 */
const toHeaders = (h: AuthRequest["headers"]): Headers => {
  if (h instanceof Headers) return h;
  const out = new Headers();
  for (const [k, v] of Object.entries(h)) {
    if (typeof v === "string") out.set(k, v);
  }
  return out;
};

const readCookie = (
  cookies: AuthRequest["cookies"],
  name: string,
): string | null => {
  if (!cookies) return null;
  if (cookies instanceof Map) return cookies.get(name) ?? null;
  const v = (cookies as Record<string, string>)[name];
  return typeof v === "string" ? v : null;
};

const extractBearer = (headerValue: string | null): string | null => {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

/**
 * Extract credentials from an HTTP-like request, validate them, and resolve
 * the active tenant. Yields a fully-populated {@link CurrentUserShape}.
 *
 * Precedence:
 *   1. `Authorization: Bearer <token>`
 *      a. If the token looks like an API key (`ApiKeys.isApiKey`), validate
 *         via `ApiKeys.validateKey` — API keys are tenant-scoped at issue
 *         time, so `Tenancy.resolveForUser` is skipped. The role is still
 *         resolved via `Tenancy.assertMembership` since tenant_members is
 *         the source of truth for roles.
 *      b. Otherwise, treat as a session token: `Sessions.validateToken`.
 *   2. Cookie `better-auth.session_token` (falls back to `session`):
 *      validated as a session token.
 *   3. No credentials → `UnauthorizedError`.
 *
 * For session-based identities, tenant resolution follows Option B:
 * `x-tenant-id` header wins; otherwise single-membership auto-selects;
 * otherwise `TenantNotSelectedError` surfaces directly (not collapsed into
 * `UnauthorizedError`) so UIs can render a tenant picker.
 */
export const resolveCurrentUser = (
  req: AuthRequest,
): Effect.Effect<
  CurrentUserShape,
  UnauthorizedError | TenantNotSelectedError,
  ApiKeys | Sessions | Tenancy
> =>
  Effect.gen(function* () {
    const apiKeys = yield* ApiKeys.asEffect();
    const sessions = yield* Sessions.asEffect();
    const tenancy = yield* Tenancy.asEffect();

    const authHeader = readHeader(req.headers, "authorization");
    const bearerToken = extractBearer(authHeader);

    // --- Path 1a: API-key bearer ---------------------------------------
    if (bearerToken && apiKeys.isApiKey(bearerToken)) {
      const validated = yield* apiKeys.validateKey(bearerToken).pipe(
        Effect.catchTag("InvalidApiKeyError", (e) =>
          Effect.fail(new UnauthorizedError({ message: e.message })),
        ),
      );
      // API keys are tenant-scoped; role comes from the tenant_members row.
      // If FK cascades ever leave a key-without-membership, treat defensively
      // as Unauthorized.
      const role = yield* tenancy
        .assertMembership(validated.userId, validated.tenantId)
        .pipe(
          Effect.catchTag("NotAMemberError", () =>
            Effect.fail(
              new UnauthorizedError({
                message: "API key user is not a member of the scoped tenant",
              }),
            ),
          ),
        );
      return {
        userId: validated.userId,
        tenantId: validated.tenantId,
        email: validated.email,
        role,
      };
    }

    // Tenant resolution (Option B): `x-tenant-id` header wins; otherwise
    // single-membership auto-selects; otherwise `TenantNotSelectedError`
    // propagates unchanged so callers can render a picker. Shared by the
    // session-bearer (Path 1b) and signed-cookie (Path 2) branches.
    const resolveWithTenant = (identity: {
      readonly userId: UserId;
      readonly email: string;
    }): Effect.Effect<
      CurrentUserShape,
      UnauthorizedError | TenantNotSelectedError
    > =>
      Effect.gen(function* () {
        const hintRaw = readHeader(req.headers, "x-tenant-id");
        const hint: TenantId | null =
          hintRaw && hintRaw.length > 0 ? (hintRaw as TenantId) : null;
        const membership: Membership = yield* tenancy
          .resolveForUser(identity.userId, hint)
          .pipe(
            // `NotAMemberError` (hint pointed to a non-member tenant) is a
            // 401 signal from the user's point of view;
            // `TenantNotSelectedError` propagates unchanged so the caller
            // can render a picker.
            Effect.catchTag("NotAMemberError", () =>
              Effect.fail(
                new UnauthorizedError({
                  message: "Not a member of the requested tenant",
                }),
              ),
            ),
          );
        return {
          userId: identity.userId,
          tenantId: membership.tenantId,
          email: identity.email,
          role: membership.role,
        };
      });

    // --- Path 1b: session bearer token (rare; CLI clients) -------------
    // Bearer session tokens aren't HMAC-signed, so we keep the raw DB
    // lookup here. Signature-aware verification is reserved for the
    // cookie path (Path 2) below.
    if (bearerToken) {
      const identity = yield* sessions.validateToken(bearerToken).pipe(
        Effect.catchTag("SessionExpiredError", (e) =>
          Effect.fail(new UnauthorizedError({ message: e.message })),
        ),
      );
      return yield* resolveWithTenant(identity);
    }

    // --- Path 2: signed cookie via better-auth -------------------------
    // Cookie path delegates to `Sessions.validateRequest`, which calls
    // better-auth's `api.getSession({ headers })` to unsign the cookie
    // before doing the DB lookup. Without this, signature-blind raw
    // lookups never match a real better-auth-issued cookie value.
    const cookieToken =
      readCookie(req.cookies, DEFAULT_SESSION_COOKIE_NAME) ??
      readCookie(req.cookies, "session");
    if (!cookieToken) {
      return yield* Effect.fail(
        new UnauthorizedError({ message: "No credentials" }),
      );
    }
    const headers = toHeaders(req.headers);
    const identity = yield* sessions.validateRequest(headers).pipe(
      Effect.catchTag("SessionExpiredError", (e) =>
        Effect.fail(new UnauthorizedError({ message: e.message })),
      ),
    );
    return yield* resolveWithTenant(identity);
  });

/**
 * Wrap a handler effect so that `CurrentUser` is provided for its duration.
 * The outer effect surfaces the auth error channel alongside the handler's
 * own errors, and pulls `ApiKeys | Sessions | Tenancy` into its requirements.
 *
 * Intended composition point for RPC handlers:
 *   const handler = provideCurrentUser(req, Effect.gen(function* () { ... }));
 */
export const provideCurrentUser = <A, E, R>(
  req: AuthRequest,
  handler: Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  E | UnauthorizedError | TenantNotSelectedError,
  Exclude<R, CurrentUser> | ApiKeys | Sessions | Tenancy
> =>
  Effect.gen(function* () {
    const user = yield* resolveCurrentUser(req);
    return yield* handler.pipe(Effect.provideService(CurrentUser, user));
  }) as Effect.Effect<
    A,
    E | UnauthorizedError | TenantNotSelectedError,
    Exclude<R, CurrentUser> | ApiKeys | Sessions | Tenancy
  >;
