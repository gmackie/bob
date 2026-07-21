/**
 * Snapshot handler functions — pure business logic extracted from the tRPC
 * snapshot router.
 *
 * Phase 7B-4D Task 2.
 */
import { TRPCError } from "@trpc/server";
import { desc, eq, and } from "@bob/db";
import type { Db } from "@bob/db/client";
import { workItemSnapshots, workItems, workspaceMembers } from "@bob/db/schema";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

async function loadAccessibleWorkItem(
  db: Db,
  userId: string,
  workItemId: string,
) {
  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
    columns: { id: true, workspaceId: true },
  });

  if (!workItem?.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workItem.workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  return workItem;
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function snapshotCreate(
  ctx: HandlerContext,
  input: { workItemId: string; stage: string; data: Record<string, unknown> },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  const [snapshot] = await ctx.db
    .insert(workItemSnapshots)
    .values({
      workItemId: input.workItemId,
      stage: input.stage,
      data: input.data,
    })
    .returning();
  return snapshot;
}

export async function snapshotList(
  ctx: HandlerContext,
  input: { workItemId: string },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  return ctx.db
    .select()
    .from(workItemSnapshots)
    .where(eq(workItemSnapshots.workItemId, input.workItemId))
    .orderBy(desc(workItemSnapshots.createdAt));
}

export async function snapshotGet(
  ctx: HandlerContext,
  input: { id: string },
) {
  const rows = await ctx.db
    .select()
    .from(workItemSnapshots)
    .where(eq(workItemSnapshots.id, input.id))
    .limit(1);
  const snapshot = rows[0] ?? null;

  if (!snapshot) {
    return null;
  }

  await loadAccessibleWorkItem(ctx.db, ctx.userId, snapshot.workItemId);

  return snapshot;
}
