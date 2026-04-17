import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { publicProcedure } from "../trpc";
import { message } from "@gmacko/db";

export const messagesRouter = {
  listByBranch: publicProcedure
    .input(z.object({
      threadId: z.string().uuid(),
      branchId: z.string().uuid(),
    }))
    .query(({ ctx, input }) =>
      ctx.db.select().from(message)
        .where(and(
          eq(message.threadId, input.threadId),
          eq(message.branchId, input.branchId),
        ))
        .orderBy(asc(message.createdAt))
    ),

  create: publicProcedure
    .input(z.object({
      threadId: z.string().uuid(),
      branchId: z.string().uuid(),
      parentId: z.string().uuid().nullable(),
      role: z.enum(["user", "assistant", "system"]),
      content: z.string().min(1),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [msg] = await ctx.db.insert(message).values(input).returning();
      return msg;
    }),
};
