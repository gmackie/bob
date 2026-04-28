import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "@bob/db";
import { and } from "@bob/db";
import { workItemSnapshots, workItems, workspaceMembers } from "@bob/db/schema";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";

async function loadAccessibleWorkItem(db: any, userId: string, workItemId: string) {
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

export const snapshotRouter = {
  create: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        stage: z.string(),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

      const [snapshot] = await ctx.db
        .insert(workItemSnapshots)
        .values({
          workItemId: input.workItemId,
          stage: input.stage,
          data: input.data,
        })
        .returning();
      return snapshot;
    }),

  list: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

      return ctx.db
        .select()
        .from(workItemSnapshots)
        .where(eq(workItemSnapshots.workItemId, input.workItemId))
        .orderBy(desc(workItemSnapshots.createdAt));
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(workItemSnapshots)
        .where(eq(workItemSnapshots.id, input.id))
        .limit(1);
      const snapshot = rows[0] ?? null;

      if (!snapshot) {
        return null;
      }

      await loadAccessibleWorkItem(
        ctx.db,
        ctx.session.user.id,
        snapshot.workItemId,
      );

      return snapshot;
    }),
} satisfies TRPCRouterRecord;
