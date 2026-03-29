import { z } from "zod/v4";
import { desc, eq } from "@bob/db";
import { agentRuns } from "@bob/db/schema";
import { protectedProcedure } from "../trpc";

export const agentRunRouter = {
  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
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
      return ctx.db.query.agentRuns.findMany({
        where: eq(agentRuns.workItemId, input.workItemId),
        with: { artifacts: true },
        orderBy: [desc(agentRuns.createdAt)],
        limit: input.limit,
      });
    }),
};
