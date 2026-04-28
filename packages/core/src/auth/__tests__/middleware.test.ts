import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { createTestDb } from "@gmacko/core/db/testing";
import { layerGmackoDb } from "@gmacko/core/db";
import { sessions, users } from "@gmacko/core/db/schema/auth";
import { tenants, tenantMembers } from "@gmacko/core/db/schema/tenancy";
import type { TenantId, UserId } from "@gmacko/core/validators";

import { UnauthorizedError } from "@gmacko/rpc/errors";

import { ApiKeys, layerApiKeys } from "../api-keys.js";
import { layerBetterAuth } from "../better-auth.js";
import { Sessions, layerSessions } from "../sessions.js";
import { Tenancy, TenantNotSelectedError, layerTenancy } from "../tenancy.js";
import {
  resolveCurrentUser,
  DEFAULT_SESSION_COOKIE_NAME,
} from "../middleware.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;

const USER_ID = "user_middleware_abc" as UserId;
const USER_EMAIL = "middleware-user@example.com";
const TENANT_A = "11111111-aaaa-aaaa-aaaa-111111111111" as TenantId;
const TENANT_B = "22222222-bbbb-bbbb-bbbb-222222222222" as TenantId;
const VALID_SESSION_TOKEN = "tok_mw_valid_abc123";
const SECOND_USER_ID = "user_no_members_xyz" as UserId;
const SECOND_USER_EMAIL = "no-members@example.com";
const SECOND_SESSION_TOKEN = "tok_mw_no_members";
// Signed-cookie token used for the cookie-path tests. Intentionally NOT
// present in the `sessions` table — the only way for the middleware to
// resolve it is to delegate to `Sessions.validateRequest`, which routes
// through the better-auth stub below.
const SIGNED_COOKIE_TOKEN = "signed-cookie-tok";

// Better-auth stub. The bearer/token paths still hit `validateToken`
// (drizzle DB lookup), but the cookie path now goes through
// `validateRequest` → `auth.api.getSession`. The stub recognises the
// `SIGNED_COOKIE_TOKEN` substring on the request `Cookie` header and
// returns the canonical USER_ID; otherwise returns null (no session).
const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const cookie = headers.get("cookie") ?? "";
      if (cookie.includes(SIGNED_COOKIE_TOKEN)) {
        return {
          session: { userId: USER_ID, token: SIGNED_COOKIE_TOKEN },
          user: { id: USER_ID, email: USER_EMAIL },
        };
      }
      return null;
    },
  },
} as unknown as Parameters<typeof layerBetterAuth>[0];

let ctx: TestCtx;
let deps: Layer.Layer<ApiKeys | Sessions | Tenancy>;

async function seedBase(memberships: ReadonlyArray<TenantId>, role: "owner" | "admin" | "member" = "owner") {
  await ctx.db.insert(users).values([
    { id: USER_ID, name: "MW User", email: USER_EMAIL },
    { id: SECOND_USER_ID, name: "No Members", email: SECOND_USER_EMAIL },
  ]);
  const now = Date.now();
  await ctx.db.insert(sessions).values([
    {
      id: "sess_mw_valid",
      userId: USER_ID,
      token: VALID_SESSION_TOKEN,
      expiresAt: new Date(now + 60 * 60 * 1000),
    },
    {
      id: "sess_mw_no_members",
      userId: SECOND_USER_ID,
      token: SECOND_SESSION_TOKEN,
      expiresAt: new Date(now + 60 * 60 * 1000),
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

beforeEach(async () => {
  ctx = await createTestDb();
  const dbLayer = layerGmackoDb(ctx.db);
  const authBaseLayer = Layer.mergeAll(dbLayer, layerBetterAuth(fakeAuth));
  deps = Layer.mergeAll(
    Layer.provide(layerApiKeys(), dbLayer),
    Layer.provide(layerSessions, authBaseLayer),
    Layer.provide(layerTenancy, dbLayer),
  );
});

afterEach(async () => {
  await ctx.teardown();
});

describe("@gmacko/auth middleware resolveCurrentUser", () => {
  it.effect("API-key happy path: Bearer <gmk_*> resolves userId/tenantId/email/role from tenant_members", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedBase([TENANT_A], "admin"));
      const apiKeys = yield* ApiKeys.asEffect();
      const issued = yield* apiKeys.issueKey({
        userId: USER_ID,
        tenantId: TENANT_A,
        name: "mw-test",
      });
      const user = yield* resolveCurrentUser({
        headers: new Headers({ authorization: `Bearer ${issued.plaintext}` }),
      });
      expect(user.userId).toBe(USER_ID);
      expect(user.tenantId).toBe(TENANT_A);
      expect(user.email).toBe(USER_EMAIL);
      expect(user.role).toBe("admin");
    }).pipe(Effect.provide(deps)),
  );

  it.effect("Session-bearer happy path: Bearer <session_token> + single membership auto-selects tenant", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedBase([TENANT_A], "owner"));
      const user = yield* resolveCurrentUser({
        headers: new Headers({ authorization: `Bearer ${VALID_SESSION_TOKEN}` }),
      });
      expect(user.userId).toBe(USER_ID);
      expect(user.tenantId).toBe(TENANT_A);
      expect(user.email).toBe(USER_EMAIL);
      expect(user.role).toBe("owner");
    }).pipe(Effect.provide(deps)),
  );

  it.effect("Session-cookie happy path: better-auth.session_token cookie resolves identity via validateRequest", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedBase([TENANT_A], "member"));
      const user = yield* resolveCurrentUser({
        // The signed-cookie token isn't in the DB; only the better-auth
        // stub recognises it. This proves the cookie path delegates to
        // `Sessions.validateRequest` (signature-aware) rather than
        // doing a raw `validateToken` DB lookup.
        headers: new Headers({
          cookie: `${DEFAULT_SESSION_COOKIE_NAME}=${SIGNED_COOKIE_TOKEN}`,
        }),
        cookies: { [DEFAULT_SESSION_COOKIE_NAME]: SIGNED_COOKIE_TOKEN },
      });
      expect(user.userId).toBe(USER_ID);
      expect(user.tenantId).toBe(TENANT_A);
      expect(user.role).toBe("member");
    }).pipe(Effect.provide(deps)),
  );

  it.effect("Explicit x-tenant-id honored over auto-select when user has 2 memberships", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedBase([TENANT_A, TENANT_B], "admin"));
      const user = yield* resolveCurrentUser({
        headers: new Headers({
          "x-tenant-id": TENANT_B,
          cookie: `${DEFAULT_SESSION_COOKIE_NAME}=${SIGNED_COOKIE_TOKEN}`,
        }),
        cookies: { [DEFAULT_SESSION_COOKIE_NAME]: SIGNED_COOKIE_TOKEN },
      });
      expect(user.userId).toBe(USER_ID);
      expect(user.tenantId).toBe(TENANT_B);
      expect(user.role).toBe("admin");
    }).pipe(Effect.provide(deps)),
  );

  it.effect("No credentials → UnauthorizedError('No credentials')", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedBase([TENANT_A]));
      const caught = yield* resolveCurrentUser({ headers: new Headers() }).pipe(
        Effect.catchTag("UnauthorizedError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(UnauthorizedError);
      expect((caught as UnauthorizedError).message).toContain("No credentials");
    }).pipe(Effect.provide(deps)),
  );

  it.effect("Invalid bearer (wrong prefix, fails isApiKey → treated as session, validateToken fails) → UnauthorizedError", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedBase([TENANT_A]));
      const caught = yield* resolveCurrentUser({
        headers: new Headers({ authorization: "Bearer not_a_real_token" }),
      }).pipe(Effect.catchTag("UnauthorizedError", (err) => Effect.succeed(err)));
      expect(caught).toBeInstanceOf(UnauthorizedError);
    }).pipe(Effect.provide(deps)),
  );

  it.effect("Revoked API key → UnauthorizedError", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedBase([TENANT_A]));
      const apiKeys = yield* ApiKeys.asEffect();
      const issued = yield* apiKeys.issueKey({
        userId: USER_ID,
        tenantId: TENANT_A,
        name: "will-revoke",
      });
      yield* apiKeys.revokeKey(issued.id);
      const caught = yield* resolveCurrentUser({
        headers: new Headers({ authorization: `Bearer ${issued.plaintext}` }),
      }).pipe(Effect.catchTag("UnauthorizedError", (err) => Effect.succeed(err)));
      expect(caught).toBeInstanceOf(UnauthorizedError);
      expect((caught as UnauthorizedError).message).toContain("revoked");
    }).pipe(Effect.provide(deps)),
  );

  it.effect("User with 0 memberships → TenantNotSelectedError (not collapsed to Unauthorized)", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedBase([TENANT_A]));
      // SECOND_USER_ID has no memberships; log them in via their session.
      const caught = yield* resolveCurrentUser({
        headers: new Headers({ authorization: `Bearer ${SECOND_SESSION_TOKEN}` }),
      }).pipe(
        Effect.catchTag("TenantNotSelectedError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(TenantNotSelectedError);
      expect((caught as TenantNotSelectedError).memberships).toEqual([]);
    }).pipe(Effect.provide(deps)),
  );

  it.effect("User with 2 memberships, no hint → TenantNotSelectedError listing both", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => seedBase([TENANT_A, TENANT_B], "member"));
      const caught = yield* resolveCurrentUser({
        headers: new Headers({ authorization: `Bearer ${VALID_SESSION_TOKEN}` }),
      }).pipe(
        Effect.catchTag("TenantNotSelectedError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(TenantNotSelectedError);
      expect((caught as TenantNotSelectedError).memberships).toHaveLength(2);
    }).pipe(Effect.provide(deps)),
  );
});
