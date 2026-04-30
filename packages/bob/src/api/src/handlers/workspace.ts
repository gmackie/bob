/**
 * Workspace handler functions — pure business logic extracted from the tRPC
 * workspace router.
 *
 * Phase 7B-4D-beta Task 2.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "@bob/db";
import {
  workspaceMembers,
  workspaces,
  workspaceMemberRole,
} from "@bob/db/schema";

import type { HandlerContext } from "./context.js";

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
  const [workspace] = await ctx.db
    .insert(workspaces)
    .values({
      ownerUserId: ctx.userId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
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
