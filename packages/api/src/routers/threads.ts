import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { publicProcedure } from "../trpc";
import { thread, branch, CreateThreadSchema, UpdateThreadStatusSchema } from "@gmacko/db";

export const threadsRouter = {
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.select().from(thread).orderBy(desc(thread.updatedAt))
  ),

  byId: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      ctx.db.select().from(thread).where(eq(thread.id, input.id)).then(r => r[0])
    ),

  create: publicProcedure
    .input(CreateThreadSchema)
    .mutation(async ({ ctx, input }) => {
      const [newThread] = await ctx.db.insert(thread).values(input).returning();
      // Create default "Main" branch
      await ctx.db.insert(branch).values({
        threadId: newThread.id,
        name: "Main",
      });
      // Update activeBranchId
      const [mainBranch] = await ctx.db.select().from(branch)
        .where(eq(branch.threadId, newThread.id));
      await ctx.db.update(thread)
        .set({ activeBranchId: mainBranch.id })
        .where(eq(thread.id, newThread.id));
      return { ...newThread, activeBranchId: mainBranch.id };
    }),

  updateStatus: publicProcedure
    .input(UpdateThreadStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db.update(thread)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(thread.id, input.id))
        .returning();
      return updated;
    }),
};
