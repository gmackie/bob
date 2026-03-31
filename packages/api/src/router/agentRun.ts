import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { and, desc, eq } from "@bob/db";
import { agentRuns, workItems, workspaceMembers } from "@bob/db/schema";
import { protectedProcedure } from "../trpc";

async function assertWorkspaceAccess(db: any, userId: string, workspaceId: string) {
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

async function loadAccessibleWorkItem(db: any, userId: string, workItemId: string) {
  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
    columns: { id: true, workspaceId: true },
  });

  if (!workItem?.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await assertWorkspaceAccess(db, userId, workItem.workspaceId);
  return workItem;
}

export const agentRunRouter = {
  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertWorkspaceAccess(ctx.db, ctx.session.user.id, input.workspaceId);

      return ctx.db.query.agentRuns.findMany({
        where: eq(agentRuns.workspaceId, input.workspaceId),
        with: { artifacts: true },
        orderBy: [desc(agentRuns.createdAt)],
        limit: input.limit,
      });
    }),

  listByWorkItem: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().min(1),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

      return ctx.db.query.agentRuns.findMany({
        where: eq(agentRuns.workItemId, input.workItemId),
        with: { artifacts: true },
        orderBy: [desc(agentRuns.createdAt)],
        limit: input.limit,
      });
    }),
};
