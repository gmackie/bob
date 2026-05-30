/**
 * Workspace handler functions — pure business logic extracted from the tRPC
 * workspace router.
 *
 * Phase 7B-4D-beta Task 2.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "@bob/db";
import {
  tenants,
  tenantMembers,
  workspaceMembers,
  workspaces,
  workspaceMemberRole,
} from "@bob/db/schema";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Ensure the user belongs to a tenant, creating a personal one if needed.
 *
 * Every workspace MUST have a tenant: agent_runs.tenant_id is NOT NULL, and the
 * ws-gateway only records a run when the workspace has a tenant. A tenant-less
 * workspace silently drops every agent run (see relay.ts handleSessionClaimed).
 * Mirrors the ensureTenant logic in publicApi.ts.
 *
 * Returns the tenant id, or null if it genuinely couldn't be resolved.
 */
export async function ensureTenantForUser(
  db: any,
  userId: string,
): Promise<string | null> {
  const existing = await db.query.tenantMembers.findFirst({
    where: eq(tenantMembers.userId, userId),
    columns: { tenantId: true },
  });
  if (existing?.tenantId) return existing.tenantId;

  const slug = userId.replace(/[^a-z0-9-]/g, "-").slice(0, 64);
  try {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: slug, slug, plan: "free" })
      .onConflictDoNothing()
      .returning();

    if (tenant) {
      await db
        .insert(tenantMembers)
        .values({ tenantId: tenant.id, userId, role: "owner" })
        .onConflictDoNothing();
      return tenant.id;
    }
  } catch {
    // Concurrent request already created the tenant — fall through to re-query.
  }

  const after = await db.query.tenantMembers.findFirst({
    where: eq(tenantMembers.userId, userId),
    columns: { tenantId: true },
  });
  return after?.tenantId ?? null;
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function workspaceList(ctx: HandlerContext, _input?: void) {
  return ctx.db.query.workspaceMembers.findMany({
    where: eq(workspaceMembers.userId, ctx.userId),
    with: {
      workspace: true,
    },
    orderBy: desc(workspaceMembers.joinedAt),
  });
}

export async function workspaceCreate(
  ctx: HandlerContext,
  input: { name: string; slug: string; description?: string },
) {
  // Attach the workspace to the user's tenant so daemon-executed agent runs are
  // recorded (agent_runs.tenant_id is NOT NULL). Without this every run on the
  // workspace is silently dropped by the ws-gateway.
  const tenantId = await ensureTenantForUser(ctx.db, ctx.userId);

  const [workspace] = await ctx.db
    .insert(workspaces)
    .values({
      ownerUserId: ctx.userId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      tenantId: tenantId ?? null,
    })
    .returning();

  await ctx.db
    .insert(workspaceMembers)
    .values({
      workspaceId: workspace!.id,
      userId: ctx.userId,
      role: "owner" satisfies (typeof workspaceMemberRole)[number],
    })
    .returning();

  return workspace;
}

export async function workspaceRename(
  ctx: HandlerContext,
  input: { id: string; name: string },
) {
  const membership = await ctx.db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, input.id),
      eq(workspaceMembers.userId, ctx.userId),
    ),
  });
  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Not a member of this workspace",
    });
  }

  const [updated] = await ctx.db
    .update(workspaces)
    .set({ name: input.name })
    .where(eq(workspaces.id, input.id))
    .returning();

  return updated;
}

export async function workspaceDelete(
  ctx: HandlerContext,
  input: { id: string },
) {
  // Verify ownership
  const membership = await ctx.db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.workspaceId, input.id),
    with: { workspace: true },
  });

  if (
    !membership ||
    membership.userId !== ctx.userId ||
    membership.role !== "owner"
  ) {
    throw new Error("Not authorized to delete this workspace");
  }

  await ctx.db
    .delete(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, input.id));
  await ctx.db.delete(workspaces).where(eq(workspaces.id, input.id));

  return { deleted: true };
}
