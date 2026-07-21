/**
 * Workspace handler functions — pure business logic extracted from the tRPC
 * workspace router.
 *
 * Phase 7B-4D-beta Task 2.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "@bob/db";
import type { Db } from "@bob/db/client";
import type {
  workspaceMemberRole} from "@bob/db/schema";
import {
  tenants,
  tenantMembers,
  workspaceMembers,
  workspaces
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
  db: Db,
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

async function ensureTenantMembership(
  db: Db,
  userId: string,
  tenantId: string,
): Promise<void> {
  const existing = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.userId, userId),
    ),
    columns: { id: true },
  });
  if (existing) return;

  await db.insert(tenantMembers).values({
    tenantId,
    userId,
    role: "member",
  });
}

async function ensureWorkspaceMembership(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const existing = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });
  if (existing) return;

  await db.insert(workspaceMembers).values({
    workspaceId,
    userId,
    role: "owner" satisfies (typeof workspaceMemberRole)[number],
  });
}

export async function ensureUserMembershipForOwnedWorkspaces(
  db: Db,
  userId: string,
): Promise<void> {
  const ownedWorkspaces = await db.query.workspaces.findMany({
    where: eq(workspaces.ownerUserId, userId),
    columns: {
      id: true,
      tenantId: true,
    },
  });

  for (const workspace of ownedWorkspaces) {
    const tenantId = workspace.tenantId ?? (await ensureTenantForUser(db, userId));

    if (tenantId) {
      await ensureTenantMembership(db, userId, tenantId);
    }

    if (!workspace.tenantId && tenantId) {
      await db
        .update(workspaces)
        .set({ tenantId })
        .where(eq(workspaces.id, workspace.id));
    }

    await ensureWorkspaceMembership(db, userId, workspace.id);
  }
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

  if (!workspace) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create workspace",
    });
  }

  await ctx.db
    .insert(workspaceMembers)
    .values({
      workspaceId: workspace.id,
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

export async function workspaceSetDefaultAgent(
  ctx: HandlerContext,
  input: { id: string; defaultAgentType: string | null },
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
    .set({ defaultAgentType: input.defaultAgentType })
    .where(eq(workspaces.id, input.id))
    .returning();

  return updated;
}

/**
 * Add a seat (tenant member) to the caller's tenant. Enforces the plan's
 * `seats` quota when usage limits are enabled.
 */
export async function tenantAddMember(
  ctx: HandlerContext,
  input: {
    userId: string;
    role?: "owner" | "admin" | "member";
  },
) {
  const membership = await ctx.db.query.tenantMembers.findFirst({
    where: eq(tenantMembers.userId, ctx.userId),
    columns: { tenantId: true, role: true },
  });
  if (!membership) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No tenant to add members to — create a workspace first",
    });
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only tenant owners and admins can add seats",
    });
  }

  const existing = await ctx.db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.tenantId, membership.tenantId),
      eq(tenantMembers.userId, input.userId),
    ),
    columns: { id: true, role: true },
  });
  if (existing) {
    return {
      id: existing.id,
      tenantId: membership.tenantId,
      userId: input.userId,
      role: existing.role,
      alreadyMember: true as const,
    };
  }

  const { assertWithinQuotaOrThrow } = await import("../services/quotas/index.js");
  await assertWithinQuotaOrThrow({
    db: ctx.db,
    tenantId: membership.tenantId,
    metric: "seats",
  });

  const [row] = await ctx.db
    .insert(tenantMembers)
    .values({
      tenantId: membership.tenantId,
      userId: input.userId,
      role: input.role ?? "member",
    })
    .returning();

  if (!row) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to add tenant member",
    });
  }

  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    role: row.role,
    alreadyMember: false as const,
  };
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
    membership?.userId !== ctx.userId ||
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
