import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers.js";
import { users } from "../auth.js";
import { tenants, tenantMembers } from "../tenancy.js";
import { apiKeys } from "../api-keys.js";

describe("@gmacko/db api_keys schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    ctx = await createTestDb();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  async function seedTenantAndUser(opts: {
    userId: string;
    userName: string;
    email: string;
    tenantName: string;
    tenantSlug: string;
    role?: "owner" | "admin" | "member";
  }) {
    await ctx.db.insert(users).values({
      id: opts.userId,
      name: opts.userName,
      email: opts.email,
    });
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: opts.tenantName, slug: opts.tenantSlug })
      .returning();
    await ctx.db.insert(tenantMembers).values({
      tenantId: tenant!.id,
      userId: opts.userId,
      role: opts.role ?? "owner",
    });
    return tenant!;
  }

  it("insert + query by id: keyPrefix + permissions round-trip", async () => {
    const userId = "u_" + crypto.randomUUID();
    const tenant = await seedTenantAndUser({
      userId,
      userName: "Alice KeyHolder",
      email: "alice.key@example.com",
      tenantName: "Key Labs",
      tenantSlug: "key-labs",
    });

    const [inserted] = await ctx.db
      .insert(apiKeys)
      .values({
        tenantId: tenant.id,
        userId,
        name: "CI deploy key",
        keyHash: "hash_round_trip_1",
        keyPrefix: "gk_live_abcd",
        permissions: ["read", "write"],
      })
      .returning();

    const row = await ctx.db.query.apiKeys.findFirst({
      where: eq(apiKeys.id, inserted!.id),
    });
    expect(row?.keyPrefix).toBe("gk_live_abcd");
    expect(row?.permissions).toEqual(["read", "write"]);
    expect(row?.name).toBe("CI deploy key");
    expect(row?.revokedAt).toBeNull();
  });

  it("cascade on user delete: api_key row is removed", async () => {
    const userId = "u_" + crypto.randomUUID();
    const tenant = await seedTenantAndUser({
      userId,
      userName: "Bob Cascade",
      email: "bob.cascade.key@example.com",
      tenantName: "Cascade Co",
      tenantSlug: "cascade-key-co",
    });

    await ctx.db.insert(apiKeys).values({
      tenantId: tenant.id,
      userId,
      name: "user-cascade-key",
      keyHash: "hash_user_cascade",
      keyPrefix: "gk_live_user",
      permissions: ["read"],
    });

    await ctx.db.delete(users).where(eq(users.id, userId));

    const remaining = await ctx.db.query.apiKeys.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("cascade on tenant delete: api_key row is removed", async () => {
    const userId = "u_" + crypto.randomUUID();
    const tenant = await seedTenantAndUser({
      userId,
      userName: "Carol Cascade",
      email: "carol.cascade.key@example.com",
      tenantName: "Tenant Cascade Co",
      tenantSlug: "tenant-cascade-key",
    });

    await ctx.db.insert(apiKeys).values({
      tenantId: tenant.id,
      userId,
      name: "tenant-cascade-key",
      keyHash: "hash_tenant_cascade",
      keyPrefix: "gk_live_ten",
      permissions: ["admin"],
    });

    await ctx.db.delete(tenants).where(eq(tenants.id, tenant.id));

    const remaining = await ctx.db.query.apiKeys.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("unique on keyHash: second insert with same hash throws", async () => {
    const userId = "u_" + crypto.randomUUID();
    const tenant = await seedTenantAndUser({
      userId,
      userName: "Dave Unique",
      email: "dave.unique.key@example.com",
      tenantName: "Unique Labs",
      tenantSlug: "unique-key-labs",
    });

    const sharedHash = "hash_unique_violation";

    await ctx.db.insert(apiKeys).values({
      tenantId: tenant.id,
      userId,
      name: "first key",
      keyHash: sharedHash,
      keyPrefix: "gk_live_001",
      permissions: ["read"],
    });

    await expect(
      ctx.db.insert(apiKeys).values({
        tenantId: tenant.id,
        userId,
        name: "second key with colliding hash",
        keyHash: sharedHash,
        keyPrefix: "gk_live_002",
        permissions: ["read"],
      }),
    ).rejects.toThrow();
  });

  it("default permissions is ['read'] when not specified", async () => {
    const userId = "u_" + crypto.randomUUID();
    const tenant = await seedTenantAndUser({
      userId,
      userName: "Erin Default",
      email: "erin.default.key@example.com",
      tenantName: "Default Labs",
      tenantSlug: "default-key-labs",
    });

    const [inserted] = await ctx.db
      .insert(apiKeys)
      .values({
        tenantId: tenant.id,
        userId,
        name: "no-perms-key",
        keyHash: "hash_default_perms",
        keyPrefix: "gk_live_def",
        // permissions intentionally omitted
      })
      .returning();

    const row = await ctx.db.query.apiKeys.findFirst({
      where: eq(apiKeys.id, inserted!.id),
    });
    expect(row?.permissions).toEqual(["read"]);
  });
});
