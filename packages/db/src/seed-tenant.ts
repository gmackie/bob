import { db } from "./client";
import { tenants, tenantMembers, workspaces } from "./schema";
import { eq, isNull } from "drizzle-orm";

async function seedTenant() {
  // Create tenant #1 (your dogfood instance)
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: "gmackie",
      slug: "gmackie",
      plan: "pro",
    })
    .onConflictDoNothing()
    .returning();

  if (!tenant) {
    console.log("Tenant already exists, finding it...");
    const [existing] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, "gmackie"));
    if (!existing) throw new Error("Could not find or create tenant");
    console.log(`Found tenant: ${existing.id}`);

    // Backfill workspaces that have no tenantId
    const updated = await db
      .update(workspaces)
      .set({ tenantId: existing.id, updatedAt: new Date() })
      .where(isNull(workspaces.tenantId));
    console.log(`Backfilled ${updated.rowCount} workspaces`);

    // Add workspace owners as tenant members
    const existingWorkspaces = await db.select().from(workspaces);
    for (const ws of existingWorkspaces) {
      if (ws.ownerUserId) {
        await db
          .insert(tenantMembers)
          .values({
            tenantId: existing.id,
            userId: ws.ownerUserId,
            role: "owner",
          })
          .onConflictDoNothing();
      }
    }
    console.log("Tenant members created from workspace owners");
    return;
  }

  console.log(`Created tenant: ${tenant.id}`);

  // Backfill all existing workspaces to tenant #1
  const updated = await db
    .update(workspaces)
    .set({ tenantId: tenant.id, updatedAt: new Date() })
    .where(isNull(workspaces.tenantId));
  console.log(`Backfilled ${updated.rowCount} workspaces`);

  // Add workspace owners as tenant members
  const allWorkspaces = await db.select().from(workspaces);
  for (const ws of allWorkspaces) {
    if (ws.ownerUserId) {
      await db
        .insert(tenantMembers)
        .values({
          tenantId: tenant.id,
          userId: ws.ownerUserId,
          role: "owner",
        })
        .onConflictDoNothing();
    }
  }
  console.log("Tenant members created from workspace owners");
}

seedTenant()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
