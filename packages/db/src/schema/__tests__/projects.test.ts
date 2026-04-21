import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers.js";
import { tenants } from "../tenancy.js";
import { projects } from "../projects.js";

describe("@gmacko/db projects schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    ctx = await createTestDb();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  async function seedTenant(opts: { name: string; slug: string }) {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({ name: opts.name, slug: opts.slug })
      .returning();
    return tenant!;
  }

  it("insert + query round-trip: fields match", async () => {
    const tenant = await seedTenant({
      name: "Round Trip Labs",
      slug: "round-trip-labs",
    });

    const [inserted] = await ctx.db
      .insert(projects)
      .values({
        tenantId: tenant.id,
        slug: "acme",
        name: "Acme Project",
      })
      .returning();

    expect(inserted?.id).toBeDefined();
    expect(inserted?.tenantId).toBe(tenant.id);
    expect(inserted?.slug).toBe("acme");
    expect(inserted?.name).toBe("Acme Project");
    expect(inserted?.createdAt).toBeInstanceOf(Date);
    expect(inserted?.updatedAt).toBeInstanceOf(Date);

    const row = await ctx.db.query.projects.findFirst({
      where: eq(projects.id, inserted!.id),
    });
    expect(row?.tenantId).toBe(tenant.id);
    expect(row?.slug).toBe("acme");
    expect(row?.name).toBe("Acme Project");
  });

  it("(tenantId, slug) uniqueness: second insert with same pair throws", async () => {
    const tenant = await seedTenant({
      name: "Unique Labs",
      slug: "unique-labs-proj",
    });

    await ctx.db.insert(projects).values({
      tenantId: tenant.id,
      slug: "shared-slug",
      name: "First",
    });

    await expect(
      ctx.db.insert(projects).values({
        tenantId: tenant.id,
        slug: "shared-slug",
        name: "Second (colliding slug)",
      }),
    ).rejects.toThrow();
  });

  it("cascade on tenant delete: project rows are removed", async () => {
    const tenant = await seedTenant({
      name: "Cascade Co",
      slug: "cascade-co-proj",
    });

    await ctx.db.insert(projects).values({
      tenantId: tenant.id,
      slug: "to-be-deleted",
      name: "Project to cascade",
    });

    await ctx.db.delete(tenants).where(eq(tenants.id, tenant.id));

    const remaining = await ctx.db.query.projects.findMany({
      where: eq(projects.tenantId, tenant.id),
    });
    expect(remaining).toHaveLength(0);
  });

  it("different tenants can share a slug", async () => {
    const tenantA = await seedTenant({
      name: "Tenant A",
      slug: "tenant-a-share",
    });
    const tenantB = await seedTenant({
      name: "Tenant B",
      slug: "tenant-b-share",
    });

    const [insertedA] = await ctx.db
      .insert(projects)
      .values({
        tenantId: tenantA.id,
        slug: "acme",
        name: "Acme @ Tenant A",
      })
      .returning();
    const [insertedB] = await ctx.db
      .insert(projects)
      .values({
        tenantId: tenantB.id,
        slug: "acme",
        name: "Acme @ Tenant B",
      })
      .returning();

    expect(insertedA?.id).toBeDefined();
    expect(insertedB?.id).toBeDefined();
    expect(insertedA?.id).not.toBe(insertedB?.id);
    expect(insertedA?.slug).toBe("acme");
    expect(insertedB?.slug).toBe("acme");
    expect(insertedA?.tenantId).toBe(tenantA.id);
    expect(insertedB?.tenantId).toBe(tenantB.id);
  });
});
