import { afterEach, beforeEach, describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { createTestDb } from "@gmacko/core/db/testing";
import { layerGmackoDb } from "@gmacko/core/db";
import { users } from "@gmacko/core/db/schema/auth";
import { tenants, tenantMembers } from "@gmacko/core/db/schema/tenancy";
import { apiKeys as apiKeysTable } from "@gmacko/core/db/schema/api-keys";
import { eq } from "drizzle-orm";
import type { TenantId, UserId, ApiKeyId } from "@gmacko/core/validators";

import {
  ApiKeys,
  InvalidApiKeyError,
  layerApiKeys,
} from "../api-keys.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;

const USER_ID = "user_apikey_abc" as UserId;
const USER_EMAIL = "apikey-user@example.com";
const TENANT_ID = "11111111-1111-1111-1111-111111111111" as TenantId;

let ctx: TestCtx;
let apiKeyLayer: Layer.Layer<ApiKeys>;

async function seed(ctx: TestCtx) {
  await ctx.db.insert(users).values({
    id: USER_ID,
    name: "API Key Test User",
    email: USER_EMAIL,
  });
  await ctx.db.insert(tenants).values({
    id: TENANT_ID,
    name: "Test Tenant",
    slug: "test-tenant",
  });
  await ctx.db.insert(tenantMembers).values({
    tenantId: TENANT_ID,
    userId: USER_ID,
    role: "owner",
  });
}

beforeEach(async () => {
  ctx = await createTestDb();
  await seed(ctx);
  apiKeyLayer = Layer.provide(layerApiKeys(), layerGmackoDb(ctx.db));
});

afterEach(async () => {
  await ctx.teardown();
});

describe("@gmacko/auth ApiKeys service", () => {
  it.effect("issueKey stores a hashed row and returns plaintext with gmk_ prefix + 12-char keyPrefix", () =>
    Effect.gen(function* () {
      const svc = yield* ApiKeys.asEffect();
      const issued = yield* svc.issueKey({
        userId: USER_ID,
        tenantId: TENANT_ID,
        name: "primary",
      });
      expect(issued.plaintext.startsWith("gmk_")).toBe(true);
      expect(issued.keyPrefix).toHaveLength(12);
      expect(issued.keyPrefix.startsWith("gmk_")).toBe(true);

      const rows = yield* Effect.promise(() =>
        ctx.db
          .select()
          .from(apiKeysTable)
          .where(eq(apiKeysTable.id, issued.id))
          .limit(1),
      );
      expect(rows).toHaveLength(1);
      // The stored keyHash must NOT equal the plaintext.
      expect(rows[0]!.keyHash).not.toBe(issued.plaintext);
      expect(rows[0]!.keyPrefix).toBe(issued.keyPrefix);
    }).pipe(Effect.provide(apiKeyLayer)),
  );

  it.effect("validateKey returns userId/tenantId/email/permissions for an issued key", () =>
    Effect.gen(function* () {
      const svc = yield* ApiKeys.asEffect();
      const issued = yield* svc.issueKey({
        userId: USER_ID,
        tenantId: TENANT_ID,
        name: "primary",
        permissions: ["read", "write"],
      });
      const result = yield* svc.validateKey(issued.plaintext);
      expect(result.keyId).toBe(issued.id);
      expect(result.userId).toBe(USER_ID);
      expect(result.tenantId).toBe(TENANT_ID);
      expect(result.email).toBe(USER_EMAIL);
      expect(result.permissions).toEqual(["read", "write"]);
    }).pipe(Effect.provide(apiKeyLayer)),
  );

  it.effect("validateKey rejects non-API-key strings with 'Not an API key'", () =>
    Effect.gen(function* () {
      const svc = yield* ApiKeys.asEffect();
      const caught = yield* svc.validateKey("not_a_key").pipe(
        Effect.catchTag("InvalidApiKeyError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(InvalidApiKeyError);
      expect((caught as InvalidApiKeyError).message).toContain("Not an API key");
    }).pipe(Effect.provide(apiKeyLayer)),
  );

  it.effect("validateKey rejects an unissued gmk_ prefixed key with 'not found'", () =>
    Effect.gen(function* () {
      const svc = yield* ApiKeys.asEffect();
      const caught = yield* svc.validateKey("gmk_unissuedrandomkeyvalue").pipe(
        Effect.catchTag("InvalidApiKeyError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(InvalidApiKeyError);
      expect((caught as InvalidApiKeyError).message).toContain("not found");
    }).pipe(Effect.provide(apiKeyLayer)),
  );

  it.effect("revokeKey causes subsequent validateKey to fail with 'revoked'", () =>
    Effect.gen(function* () {
      const svc = yield* ApiKeys.asEffect();
      const issued = yield* svc.issueKey({
        userId: USER_ID,
        tenantId: TENANT_ID,
        name: "to-revoke",
      });
      yield* svc.revokeKey(issued.id);
      const caught = yield* svc.validateKey(issued.plaintext).pipe(
        Effect.catchTag("InvalidApiKeyError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(InvalidApiKeyError);
      expect((caught as InvalidApiKeyError).message).toContain("revoked");
    }).pipe(Effect.provide(apiKeyLayer)),
  );

  it.effect("issueKey with negative ttlMs produces an immediately-expired key", () =>
    Effect.gen(function* () {
      const svc = yield* ApiKeys.asEffect();
      const issued = yield* svc.issueKey({
        userId: USER_ID,
        tenantId: TENANT_ID,
        name: "expired",
        ttlMs: -1000,
      });
      const caught = yield* svc.validateKey(issued.plaintext).pipe(
        Effect.catchTag("InvalidApiKeyError", (err) => Effect.succeed(err)),
      );
      expect(caught).toBeInstanceOf(InvalidApiKeyError);
      expect((caught as InvalidApiKeyError).message).toContain("expired");
    }).pipe(Effect.provide(apiKeyLayer)),
  );

  it.effect("listForUser returns keys ordered by createdAt DESC, including revoked", () =>
    Effect.gen(function* () {
      const svc = yield* ApiKeys.asEffect();
      const first = yield* svc.issueKey({
        userId: USER_ID,
        tenantId: TENANT_ID,
        name: "first",
      });
      // createdAt defaults to now() at insert time; nudge ordering by
      // rewriting the first row's createdAt into the past so the ORDER BY
      // result is deterministic regardless of clock resolution.
      yield* Effect.promise(() =>
        ctx.db
          .update(apiKeysTable)
          .set({ createdAt: new Date(Date.now() - 60_000) })
          .where(eq(apiKeysTable.id, first.id)),
      );
      const second = yield* svc.issueKey({
        userId: USER_ID,
        tenantId: TENANT_ID,
        name: "second",
      });
      yield* svc.revokeKey(second.id);

      const list = yield* svc.listForUser(USER_ID, TENANT_ID);
      expect(list).toHaveLength(2);
      expect(list[0]!.id).toBe(second.id);
      expect(list[0]!.revokedAt).not.toBeNull();
      expect(list[1]!.id).toBe(first.id);
      expect(list[1]!.revokedAt).toBeNull();
    }).pipe(Effect.provide(apiKeyLayer)),
  );

  it.effect("isApiKey honors default and custom prefix lists", () =>
    Effect.gen(function* () {
      const defaultSvc = yield* ApiKeys.asEffect();
      expect(defaultSvc.isApiKey("gmk_something")).toBe(true);
      expect(defaultSvc.isApiKey("bob_abc")).toBe(false);
      expect(defaultSvc.isApiKey(null)).toBe(false);
      expect(defaultSvc.isApiKey(undefined)).toBe(false);

      // Build a service with a broader prefix set and assert bob_ is accepted.
      const multiLayer = Layer.provide(
        layerApiKeys({ prefixes: ["gmk_", "bob_"] }),
        layerGmackoDb(ctx.db),
      );
      const multiResult = yield* Effect.gen(function* () {
        const svc = yield* ApiKeys.asEffect();
        return {
          gmk: svc.isApiKey("gmk_abc"),
          bob: svc.isApiKey("bob_abc"),
          other: svc.isApiKey("other_abc"),
        };
      }).pipe(Effect.provide(multiLayer));
      expect(multiResult).toEqual({ gmk: true, bob: true, other: false });
    }).pipe(Effect.provide(apiKeyLayer)),
  );

  it.effect("custom issuing prefix at layer construction is used by issueKey", () =>
    Effect.gen(function* () {
      const bobLayer = Layer.provide(
        layerApiKeys({ prefixes: ["bob_"] }),
        layerGmackoDb(ctx.db),
      );
      const issued = yield* Effect.gen(function* () {
        const svc = yield* ApiKeys.asEffect();
        return yield* svc.issueKey({
          userId: USER_ID,
          tenantId: TENANT_ID,
          name: "bob-key",
        });
      }).pipe(Effect.provide(bobLayer));
      expect(issued.plaintext.startsWith("bob_")).toBe(true);
      expect(issued.keyPrefix.startsWith("bob_")).toBe(true);
    }),
  );
});
