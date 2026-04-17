import { z } from "zod";
import { eq } from "drizzle-orm";
import { publicProcedure } from "../trpc";
import { branch, thread } from "@gmacko/db";

export const branchesRouter = {
  listByThread: publicProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      ctx.db.select().from(branch).where(eq(branch.threadId, input.threadId))
    ),

  create: publicProcedure
    .input(z.object({
      threadId: z.string().uuid(),
      parentBranchId: z.string().uuid(),
      forkPointMessageId: z.string().uuid(),
      name: z.string().min(1).max(256),
    }))
    .mutation(async ({ ctx, input }) => {
      const [newBranch] = await ctx.db.insert(branch).values(input).returning();
      return newBranch;
    }),

  setActive: publicProcedure
    .input(z.object({ threadId: z.string().uuid(), branchId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(thread)
        .set({ activeBranchId: input.branchId, updatedAt: new Date() })
        .where(eq(thread.id, input.threadId));
    }),
};
