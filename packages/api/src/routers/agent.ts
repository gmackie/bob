import { z } from "zod";
import { eq, and, asc } from "drizzle-orm";
import { publicProcedure } from "../trpc";
import { message } from "@gmacko/db";
import { dispatchAgent } from "@gmacko/agent";

export const agentRouter = {
  chat: publicProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        branchId: z.string().uuid(),
        content: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Save user message
      const [userMsg] = await ctx.db
        .insert(message)
        .values({
          threadId: input.threadId,
          branchId: input.branchId,
          parentId: null, // TODO: set to last message
          role: "user",
          content: input.content,
        })
        .returning();

      // 2. Load conversation history for this branch
      const history = await ctx.db
        .select()
        .from(message)
        .where(
          and(
            eq(message.threadId, input.threadId),
            eq(message.branchId, input.branchId),
          ),
        )
        .orderBy(asc(message.createdAt));

      // 3. Convert to Claude message format
      const claudeMessages = history
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      // 4. Call agent
      let fullContent = "";
      for await (const event of dispatchAgent({
        threadId: input.threadId,
        branchId: input.branchId,
        messages: claudeMessages,
      })) {
        if (event.type === "done") {
          fullContent = event.content;
        }
      }

      // 5. Save assistant message
      const [assistantMsg] = await ctx.db
        .insert(message)
        .values({
          threadId: input.threadId,
          branchId: input.branchId,
          parentId: userMsg!.id,
          role: "assistant",
          content: fullContent,
        })
        .returning();

      return assistantMsg;
    }),
};
