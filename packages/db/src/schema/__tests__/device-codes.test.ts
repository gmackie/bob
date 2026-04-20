import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers.js";
import { users } from "../auth.js";
import { tenants, tenantMembers } from "../tenancy.js";
import { apiKeys } from "../api-keys.js";
import { deviceCodes } from "../device-codes.js";

describe("@gmacko/db device_codes schema", () => {
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

  it("pending insert + query by deviceCode: defaults populated", async () => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const [inserted] = await ctx.db
      .insert(deviceCodes)
      .values({
        userCode: "WXYZ-1234",
        expiresAt,
      })
      .returning();

    expect(inserted?.deviceCode).toBeDefined();
    expect(inserted?.userCode).toBe("WXYZ-1234");
    expect(inserted?.status).toBe("pending");
    expect(inserted?.userId).toBeNull();
    expect(inserted?.tenantId).toBeNull();
    expect(inserted?.apiKeyId).toBeNull();

    const row = await ctx.db.query.deviceCodes.findFirst({
      where: eq(deviceCodes.deviceCode, inserted!.deviceCode),
    });
    expect(row?.status).toBe("pending");
    expect(row?.userCode).toBe("WXYZ-1234");
    expect(row?.deviceCode).toBe(inserted!.deviceCode);
  });

  it("user-code uniqueness: second insert with same user_code throws", async () => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await ctx.db.insert(deviceCodes).values({
      userCode: "DUPE-0001",
      expiresAt,
    });

    await expect(
      ctx.db.insert(deviceCodes).values({
        userCode: "DUPE-0001",
        expiresAt,
      }),
    ).rejects.toThrow();
  });

  it("approval flow: update pending -> approved with user + tenant", async () => {
    const userId = "u_" + crypto.randomUUID();
    const tenant = await seedTenantAndUser({
      userId,
      userName: "Alice Approve",
      email: "alice.approve@example.com",
      tenantName: "Approve Labs",
      tenantSlug: "approve-labs",
    });

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const [inserted] = await ctx.db
      .insert(deviceCodes)
      .values({
        userCode: "APPR-0001",
        expiresAt,
      })
      .returning();

    expect(inserted?.status).toBe("pending");

    await ctx.db
      .update(deviceCodes)
      .set({
        status: "approved",
        userId,
        tenantId: tenant.id,
      })
      .where(eq(deviceCodes.id, inserted!.id));

    const row = await ctx.db.query.deviceCodes.findFirst({
      where: eq(deviceCodes.id, inserted!.id),
    });
    expect(row?.status).toBe("approved");
    expect(row?.userId).toBe(userId);
    expect(row?.tenantId).toBe(tenant.id);
  });

  it("cascade on user delete: device_code row is removed", async () => {
    const userId = "u_" + crypto.randomUUID();
    const tenant = await seedTenantAndUser({
      userId,
      userName: "Bob UserCascade",
      email: "bob.usercascade@example.com",
      tenantName: "User Cascade Co",
      tenantSlug: "user-cascade-dc",
    });

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await ctx.db.insert(deviceCodes).values({
      userCode: "UCAS-0001",
      status: "approved",
      userId,
      tenantId: tenant.id,
      expiresAt,
    });

    await ctx.db.delete(users).where(eq(users.id, userId));

    const remaining = await ctx.db.query.deviceCodes.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("cascade on tenant delete: device_code row is removed", async () => {
    const userId = "u_" + crypto.randomUUID();
    const tenant = await seedTenantAndUser({
      userId,
      userName: "Carol TenantCascade",
      email: "carol.tenantcascade@example.com",
      tenantName: "Tenant Cascade DC",
      tenantSlug: "tenant-cascade-dc",
    });

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await ctx.db.insert(deviceCodes).values({
      userCode: "TCAS-0001",
      status: "approved",
      userId,
      tenantId: tenant.id,
      expiresAt,
    });

    await ctx.db.delete(tenants).where(eq(tenants.id, tenant.id));

    const remaining = await ctx.db.query.deviceCodes.findMany();
    expect(remaining).toHaveLength(0);
  });

  it("set null on api_key delete: device_code row remains, apiKeyId nulled", async () => {
    const userId = "u_" + crypto.randomUUID();
    const tenant = await seedTenantAndUser({
      userId,
      userName: "Dave ApiNull",
      email: "dave.apinull@example.com",
      tenantName: "Api Null Labs",
      tenantSlug: "api-null-labs",
    });

    const [apiKey] = await ctx.db
      .insert(apiKeys)
      .values({
        tenantId: tenant.id,
        userId,
        name: "device-flow-key",
        keyHash: "hash_device_flow_setnull",
        keyPrefix: "gk_live_dvc",
        permissions: ["read"],
      })
      .returning();

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const [inserted] = await ctx.db
      .insert(deviceCodes)
      .values({
        userCode: "SNUL-0001",
        status: "consumed",
        userId,
        tenantId: tenant.id,
        apiKeyId: apiKey!.id,
        expiresAt,
      })
      .returning();

    expect(inserted?.apiKeyId).toBe(apiKey!.id);

    await ctx.db.delete(apiKeys).where(eq(apiKeys.id, apiKey!.id));

    const row = await ctx.db.query.deviceCodes.findFirst({
      where: eq(deviceCodes.id, inserted!.id),
    });
    expect(row).toBeDefined();
    expect(row?.apiKeyId).toBeNull();
    expect(row?.userId).toBe(userId);
    expect(row?.tenantId).toBe(tenant.id);
  });
});
