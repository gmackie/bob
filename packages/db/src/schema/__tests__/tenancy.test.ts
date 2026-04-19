import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers.js";
import { tenants, tenantMembers } from "../tenancy.js";
import { users } from "../auth.js";

describe("@gmacko/db tenancy schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    ctx = await createTestDb();
    // Apply raw DDL — tests run per-table DDL here until Task 11 wires
    // drizzle-kit migrations into the shared helper.
    await ctx.pglite.exec(DDL);
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

// Raw DDL — applied per-test because drizzle-kit push infrastructure comes later
// (Task 11). This block is replaced with applyTestMigrations() after Task 11.
// Includes `users` because tenant_members.user_id references it.
const DDL = `
CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TYPE tenant_role AS ENUM ('owner', 'admin', 'member');
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(128) NOT NULL,
  slug varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role tenant_role NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_members_tenant_user_unique UNIQUE (tenant_id, user_id)
);
CREATE INDEX tenant_members_tenant_id_idx ON tenant_members(tenant_id);
CREATE INDEX tenant_members_user_id_idx ON tenant_members(user_id);
`;
