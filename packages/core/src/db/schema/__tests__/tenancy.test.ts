import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers.js";
import { tenants, tenantMembers } from "../tenancy.js";
import { users } from "../auth.js";

describe("@gmacko/db tenancy schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    ctx = await createTestDb();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it("tenants: insert + query by slug (unique)", async () => {
    await ctx.db.insert(tenants).values({
      name: "Acme Corp",
      slug: "acme",
    });

    const bySlug = await ctx.db.query.tenants.findFirst({
      where: eq(tenants.slug, "acme"),
    });
    expect(bySlug?.name).toBe("Acme Corp");
    expect(bySlug?.id).toBeDefined();
  });

  it("tenant_members: add member + query by tenantId", async () => {
    await ctx.db.insert(users).values({
      id: "user_member_1",
      name: "Alice",
      email: "alice@example.com",
      emailVerified: false,
    });
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Team A", slug: "team-a" })
      .returning();
    await ctx.db.insert(tenantMembers).values({
      tenantId: tenant!.id,
      userId: "user_member_1",
      role: "owner",
    });

    const members = await ctx.db.query.tenantMembers.findMany({
      where: eq(tenantMembers.tenantId, tenant!.id),
    });
    expect(members).toHaveLength(1);
    expect(members[0]?.userId).toBe("user_member_1");
    expect(members[0]?.role).toBe("owner");
  });

  it("tenant_members: (tenantId, userId) uniqueness enforced", async () => {
    await ctx.db.insert(users).values({
      id: "user_dup",
      name: "Bob",
      email: "bob@example.com",
      emailVerified: false,
    });
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Team B", slug: "team-b" })
      .returning();
    await ctx.db.insert(tenantMembers).values({
      tenantId: tenant!.id,
      userId: "user_dup",
    });

    await expect(
      ctx.db.insert(tenantMembers).values({
        tenantId: tenant!.id,
        userId: "user_dup",
      }),
    ).rejects.toThrow();
  });

  it("tenant_members: cascade on tenant delete", async () => {
    await ctx.db.insert(users).values({
      id: "user_cascade",
      name: "Carol",
      email: "carol@example.com",
      emailVerified: false,
    });
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: "Team C", slug: "team-c" })
      .returning();
    await ctx.db.insert(tenantMembers).values({
      tenantId: tenant!.id,
      userId: "user_cascade",
    });

    await ctx.db.delete(tenants).where(eq(tenants.id, tenant!.id));
    const remaining = await ctx.db.query.tenantMembers.findMany();
    expect(remaining).toHaveLength(0);
  });
});

