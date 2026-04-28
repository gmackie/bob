// Integration tests for `AuthMiddleware` — the `RpcMiddleware.Service` wrapper
// around the plain-function `resolveCurrentUser`.
//
// Approach: **in-process RPC round-trip via `RpcTest.makeClient`** with a
// mocked `HttpServerRequest` layer built from a WHATWG `Request` via
// `HttpServerRequest.fromWeb`. This exercises the full middleware → handler
// pipeline (Schema decode/encode, middleware injection, error channel
// routing) without standing up a real HTTP server. The trade-off vs a full
// `RpcServer.layerHttp` + `fetch` round-trip is that we skip the HTTP
// transport encoding — but middleware resolution, `requires: [CurrentUser]`
// wiring, and typed error channels all run through the same machinery.
//
// Why this path (per Task 2 decision tree): the full HTTP round-trip pulls
// in `HttpRouter.layer`, Node's http.createServer, port binding, and the
// full serialization stack. The `SuccessValue` middleware-internal opaque
// type (per 6C drift notes) doesn't surface here either way — what matters
// is that the handler receives a populated `CurrentUser` and that the
// middleware's error channel surfaces through the RPC error channel.
//
// Service-composition note: `HttpServerRequest` is read by the middleware
// at handler-call time, but `RpcServer.makeNoSerialization` captures
// services at server-build time (see `RpcServer.js:45 services = yield*
// Effect.services()`). So `HttpServerRequest` must be in the ambient
// environment when `RpcTest.makeClient` is evaluated — not just as a
// dependency of `layerAuthMiddleware`. We therefore provide it at the top
// level of each test's composed layer.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { Rpc, RpcGroup, RpcTest } from "effect/unstable/rpc";
import { HttpServerRequest } from "effect/unstable/http";

import { createTestDb } from "@gmacko/core/db/testing";
import { layerGmackoDb } from "@gmacko/core/db";
import { sessions, users } from "@gmacko/core/db/schema/auth";
import { tenants, tenantMembers } from "@gmacko/core/db/schema/tenancy";
import type { TenantId, UserId } from "@gmacko/core/validators";

import { CurrentUser } from "@gmacko/rpc/context";
import { UnauthorizedError } from "@gmacko/rpc/errors";

import { layerApiKeys } from "../api-keys.js";
import { layerBetterAuth } from "../better-auth.js";
import { layerSessions } from "../sessions.js";
import { layerTenancy, TenantNotSelectedError } from "../tenancy.js";
import { AuthMiddleware, layerAuthMiddleware } from "../rpc-middleware.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;

const USER_ID = "user_rpc_mw_abc" as UserId;
const USER_EMAIL = "rpc-mw-user@example.com";
const TENANT_A = "33333333-aaaa-aaaa-aaaa-333333333333" as TenantId;
const TENANT_B = "44444444-bbbb-bbbb-bbbb-444444444444" as TenantId;
const VALID_SESSION_TOKEN = "tok_rpc_mw_valid";

// Minimal better-auth stub. The signature-aware `validateRequest` cookie
// path isn't exercised in these RPC middleware tests — bearer headers go
// through `validateBearer`/`validateToken` (drizzle only).
const fakeAuth = {
  api: { getSession: async () => null },
} as unknown as Parameters<typeof layerBetterAuth>[0];

// ---- Test RpcGroup -------------------------------------------------------
// One procedure declares the middleware via RpcGroup.middleware(...).
// The success schema mirrors what real `auth.whoAmI` contracts will use.
const CurrentUserWireSchema = Schema.Struct({
  userId: Schema.String,
  tenantId: Schema.String,
  email: Schema.String,
  role: Schema.Literals(["owner", "admin", "member"] as const),
});

const WhoAmIRpc = Rpc.make("test.whoAmI", {
  payload: Schema.Void,
  success: CurrentUserWireSchema,
  error: Schema.Union([UnauthorizedError, TenantNotSelectedError]),
});

const TestGroup = RpcGroup.make(WhoAmIRpc).middleware(AuthMiddleware);

const handlersLayer = TestGroup.toLayer({
  "test.whoAmI": () =>
    Effect.gen(function* () {
      const user = yield* CurrentUser.asEffect();
      return {
        userId: user.userId as string,
        tenantId: user.tenantId as string,
        email: user.email,
        role: user.role,
      };
    }),
});

// ---- Seed helper ---------------------------------------------------------
async function seedBase(
  ctx: TestCtx,
  memberships: ReadonlyArray<TenantId>,
  role: "owner" | "admin" | "member" = "owner",
) {
  await ctx.db.insert(users).values([
    { id: USER_ID, name: "RPC MW User", email: USER_EMAIL },
  ]);
  await ctx.db.insert(sessions).values([
    {
      id: "sess_rpc_mw_valid",
      userId: USER_ID,
      token: VALID_SESSION_TOKEN,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  ]);
  const uniqueTenants = new Set(memberships);
  for (const tid of uniqueTenants) {
    await ctx.db.insert(tenants).values({
      id: tid,
      name: `T ${tid.slice(0, 4)}`,
      slug: `t-${tid.slice(0, 8)}`,
    });
  }
  for (const tid of memberships) {
    await ctx.db.insert(tenantMembers).values({
      tenantId: tid,
      userId: USER_ID,
      role,
    });
  }
}

// Build a Layer providing `HttpServerRequest` synthesized from a WHATWG
// `Request` via `HttpServerRequest.fromWeb`. This stands in for the
// real HTTP transport's per-request injection.
const httpRequestLayer = (init: {
  readonly authorization?: string;
  readonly cookie?: string;
  readonly xTenantId?: string;
}): Layer.Layer<HttpServerRequest.HttpServerRequest> => {
  const headers: Record<string, string> = {};
  if (init.authorization) headers.authorization = init.authorization;
  if (init.cookie) headers.cookie = init.cookie;
  if (init.xTenantId) headers["x-tenant-id"] = init.xTenantId;
  const req = HttpServerRequest.fromWeb(
    new Request("http://test.local/rpc", { headers }),
  );
  return Layer.succeed(HttpServerRequest.HttpServerRequest, req);
};

// ---- Fixtures ------------------------------------------------------------
let ctx: TestCtx;

beforeEach(async () => {
  ctx = await createTestDb();
});

afterEach(async () => {
  await ctx.teardown();
});

// Compose the full runtime for a test: DB-backed auth services + an
// `HttpServerRequest` stub + the AuthMiddleware layer + the RPC handlers.
// `HttpServerRequest` is provided at the top level so the RpcServer
// captures it when it's built via `RpcTest.makeClient`.
const fullLayer = (
  reqInit: Parameters<typeof httpRequestLayer>[0],
): Layer.Layer<
  Rpc.ToHandler<RpcGroup.Rpcs<typeof TestGroup>> | AuthMiddleware,
  never,
  never
> => {
  const dbLayer = layerGmackoDb(ctx.db);
  const sessionsBaseLayer = Layer.mergeAll(dbLayer, layerBetterAuth(fakeAuth));
  const authServices = Layer.mergeAll(
    Layer.provide(layerApiKeys(), dbLayer),
    Layer.provide(layerSessions, sessionsBaseLayer),
    Layer.provide(layerTenancy, dbLayer),
  );
  const middlewareLayer = Layer.provide(layerAuthMiddleware, authServices);
  return Layer.mergeAll(
    handlersLayer,
    middlewareLayer,
    httpRequestLayer(reqInit),
  ) as unknown as Layer.Layer<
    Rpc.ToHandler<RpcGroup.Rpcs<typeof TestGroup>> | AuthMiddleware,
    never,
    never
  >;
};

describe("@gmacko/auth AuthMiddleware (RpcMiddleware.Service wrapper)", () => {
  it.effect(
    "happy path: Bearer <session_token> + single membership → handler sees populated CurrentUser",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => seedBase(ctx, [TENANT_A], "owner"));
        const client = yield* RpcTest.makeClient(TestGroup);
        const result = yield* client["test.whoAmI"]();
        expect(result).toEqual({
          userId: USER_ID,
          tenantId: TENANT_A,
          email: USER_EMAIL,
          role: "owner",
        });
      }).pipe(
        Effect.provide(
          fullLayer({ authorization: `Bearer ${VALID_SESSION_TOKEN}` }),
        ),
      ),
  );

  it.effect(
    "missing credentials: error channel carries UnauthorizedError",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => seedBase(ctx, [TENANT_A]));
        const client = yield* RpcTest.makeClient(TestGroup);
        const caught = yield* Effect.flip(client["test.whoAmI"]());
        expect(caught).toBeInstanceOf(UnauthorizedError);
        expect((caught as UnauthorizedError).message).toContain(
          "No credentials",
        );
      }).pipe(Effect.provide(fullLayer({}))),
  );

  it.effect(
    "2 memberships, no hint: error channel carries TenantNotSelectedError (NOT collapsed)",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          seedBase(ctx, [TENANT_A, TENANT_B], "member"),
        );
        const client = yield* RpcTest.makeClient(TestGroup);
        const caught = yield* Effect.flip(client["test.whoAmI"]());
        expect(caught).toBeInstanceOf(TenantNotSelectedError);
        expect((caught as TenantNotSelectedError).memberships).toHaveLength(2);
      }).pipe(
        Effect.provide(
          fullLayer({ authorization: `Bearer ${VALID_SESSION_TOKEN}` }),
        ),
      ),
  );
});
