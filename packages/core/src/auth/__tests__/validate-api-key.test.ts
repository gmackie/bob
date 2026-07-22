// Integration tests for the shared plain-async `validateApiKey` — the single
// source of truth reused by both the Effect `ApiKeys` service and OODA's tRPC
// `authedProcedure`. Runs against a real PGlite Postgres with the actual
// `api_keys` / `users` schema + migrations, so the hash/join/revoked/expired
// checks are exercised end-to-end.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { createTestDb } from "@gmacko/core/db/testing";
import { users } from "@gmacko/core/db/schema/auth";
import { tenants, tenantMembers } from "@gmacko/core/db/schema/tenancy";
import { apiKeys as apiKeysTable } from "@gmacko/core/db/schema/api-keys";

import {
  API_KEY_PREFIXES,
  hashApiKey,
  isApiKeyLike,
  validateApiKey,
} from "../validate-api-key.js";

type TestCtx = Awaited<ReturnType<typeof createTestDb>>;

const USER_ID = "user_validate_apikey";
const USER_EMAIL = "validate-apikey@example.com";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";

let ctx: TestCtx;

async function seed(ctx: TestCtx) {
  await ctx.db
    .insert(users)
    .values({ id: USER_ID, name: "Validate Key User", email: USER_EMAIL });
  await ctx.db
    .insert(tenants)
    .values({ id: TENANT_ID, name: "Validate Tenant", slug: "validate-tenant" });
  await ctx.db
    .insert(tenantMembers)
    .values({ tenantId: TENANT_ID, userId: USER_ID, role: "owner" });
}

/** Insert an api_keys row for `plaintext`, returning nothing. */
async function insertKey(
  ctx: TestCtx,
  plaintext: string,
  overrides: { revokedAt?: Date; expiresAt?: Date } = {},
) {
  await ctx.db.insert(apiKeysTable).values({
    tenantId: TENANT_ID,
    userId: USER_ID,
    name: `key ${plaintext.slice(0, 12)}`,
    keyHash: createHash("sha256").update(plaintext).digest("hex"),
    keyPrefix: plaintext.slice(0, 12),
    permissions: ["read"],
    revokedAt: overrides.revokedAt ?? null,
    expiresAt: overrides.expiresAt ?? null,
  });
}

beforeEach(async () => {
  ctx = await createTestDb();
  await seed(ctx);
});

afterEach(async () => {
  await ctx.teardown();
});

describe("validateApiKey (shared plain-async validator)", () => {
  it("accepts a valid gmk_ key and returns the owning identity", async () => {
    const key = "gmk_validkey0000000000000000000000000000";
    await insertKey(ctx, key);

    const result = await validateApiKey(ctx.db as never, key);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userId).toBe(USER_ID);
      expect(result.value.email).toBe(USER_EMAIL);
      expect(result.value.permissions).toEqual(["read"]);
      // `tenantId` is intentionally NOT part of the shared payload — see
      // ValidatedApiKey docs (live Bob `api_keys` has no `tenant_id`).
      expect("tenantId" in result.value).toBe(false);
    }
  });

  it("accepts a valid bob_ (device-flow) key — the LevelForge case", async () => {
    const key = "bob_devicekey000000000000000000000000000";
    await insertKey(ctx, key);

    const result = await validateApiKey(ctx.db as never, key);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userId).toBe(USER_ID);
      expect(result.value.email).toBe(USER_EMAIL);
    }
  });

  it("rejects an unknown key with reason 'not-found'", async () => {
    const result = await validateApiKey(
      ctx.db as never,
      "bob_neverissued00000000000000000000000000",
    );
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("rejects a revoked key with reason 'revoked'", async () => {
    const key = "gmk_revokedkey00000000000000000000000000";
    await insertKey(ctx, key, { revokedAt: new Date() });

    const result = await validateApiKey(ctx.db as never, key);
    expect(result).toEqual({ ok: false, reason: "revoked" });
  });

  it("rejects an expired key with reason 'expired'", async () => {
    const key = "gmk_expiredkey00000000000000000000000000";
    await insertKey(ctx, key, { expiresAt: new Date(Date.now() - 1000) });

    const result = await validateApiKey(ctx.db as never, key);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("accepts a key whose expiry is in the future", async () => {
    const key = "gmk_futurekey000000000000000000000000000";
    await insertKey(ctx, key, { expiresAt: new Date(Date.now() + 60_000) });

    const result = await validateApiKey(ctx.db as never, key);
    expect(result.ok).toBe(true);
  });

  it("rejects a non-prefixed / malformed value with reason 'not-an-api-key'", async () => {
    for (const bad of ["not_a_key", "session_token_value", "", null, undefined]) {
      const result = await validateApiKey(ctx.db as never, bad);
      expect(result).toEqual({ ok: false, reason: "not-an-api-key" });
    }
  });

  it("does not mutate rows (read-only) — no lastUsedAt write path here", async () => {
    const key = "gmk_readonlykey0000000000000000000000000";
    await insertKey(ctx, key);
    await validateApiKey(ctx.db as never, key);
    const rows = await ctx.db
      .select({ lastUsedAt: apiKeysTable.lastUsedAt })
      .from(apiKeysTable);
    expect(rows[0]?.lastUsedAt).toBeNull();
  });
});

describe("prefix helpers", () => {
  it("API_KEY_PREFIXES is the canonical gmk_/bob_ list", () => {
    expect([...API_KEY_PREFIXES]).toEqual(["gmk_", "bob_"]);
  });

  it("isApiKeyLike matches accepted prefixes and rejects others", () => {
    expect(isApiKeyLike("gmk_x")).toBe(true);
    expect(isApiKeyLike("bob_x")).toBe(true);
    expect(isApiKeyLike("zzz_x")).toBe(false);
    expect(isApiKeyLike(null)).toBe(false);
    expect(isApiKeyLike("gmk_x", ["bob_"])).toBe(false);
  });

  it("hashApiKey is a stable sha256 hex digest", () => {
    expect(hashApiKey("gmk_abc")).toBe(
      createHash("sha256").update("gmk_abc").digest("hex"),
    );
  });
});
