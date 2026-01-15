import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq, and, asc } from "@bob/db";
import { chatConversations, chatMessages, messageRoleEnum } from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3002";

export const chatRouter = {
  listConversations: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(chatConversations.userId, ctx.session.user.id)];
      
      if (input.repositoryId) {
        conditions.push(eq(chatConversations.repositoryId, input.repositoryId));
      }

      const conversations = await ctx.db
        .select()
        .from(chatConversations)
        .where(and(...conditions))
        .orderBy(desc(chatConversations.updatedAt))
        .limit(input.limit);

      return conversations;
    }),

  getConversation: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conversation = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.id),
          eq(chatConversations.userId, ctx.session.user.id)
        ),
        with: {
          messages: {
            orderBy: asc(chatMessages.createdAt),
          },
        },
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      return conversation;
    }),

  createConversation: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid().optional(),
        worktreeId: z.string().uuid().optional(),
        workingDirectory: z.string().optional(),
        title: z.string().max(256).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [conversation] = await ctx.db
        .insert(chatConversations)
        .values({
          userId: ctx.session.user.id,
          repositoryId: input.repositoryId ?? null,
          worktreeId: input.worktreeId ?? null,
          workingDirectory: input.workingDirectory ?? null,
          title: input.title ?? null,
        })
        .returning();

      return conversation;
    }),

  deleteConversation: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(chatConversations)
        .where(
          and(
            eq(chatConversations.id, input.id),
            eq(chatConversations.userId, ctx.session.user.id)
          )
        );
      return { success: true };
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        content: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const conversation = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.conversationId),
          eq(chatConversations.userId, ctx.session.user.id)
        ),
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const [userMessage] = await ctx.db
        .insert(chatMessages)
        .values({
          conversationId: input.conversationId,
          role: "user",
          content: input.content,
        })
        .returning();

      try {
        const response = await fetch(`${GATEWAY_URL}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: ctx.session.user.id,
            conversationId: input.conversationId,
            message: input.content,
            workingDirectory: conversation.workingDirectory,
          }),
        });

        if (!response.ok) {
          throw new Error(`Gateway error: ${response.status}`);
        }

        const data = await response.json() as { 
          content: string; 
          toolCalls?: Array<{ id: string; name: string; arguments: string }>;
        };

        const [assistantMessage] = await ctx.db
          .insert(chatMessages)
          .values({
            conversationId: input.conversationId,
            role: "assistant",
            content: data.content,
            toolCalls: data.toolCalls ?? null,
          })
          .returning();

        if (!conversation.title && input.content.length > 0) {
          const title = input.content.slice(0, 50) + (input.content.length > 50 ? "..." : "");
          await ctx.db
            .update(chatConversations)
            .set({ title })
            .where(eq(chatConversations.id, input.conversationId));
        }

        return {
          userMessage,
          assistantMessage,
        };
      } catch (error) {
        const [errorMessage] = await ctx.db
          .insert(chatMessages)
          .values({
            conversationId: input.conversationId,
            role: "assistant",
            content: `Error: ${String(error)}`,
          })
          .returning();

        return {
          userMessage,
          assistantMessage: errorMessage,
        };
      }
    }),

  getMessages: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        limit: z.number().min(1).max(200).default(100),
        before: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conversation = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.conversationId),
          eq(chatConversations.userId, ctx.session.user.id)
        ),
      });

      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const messages = await ctx.db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, input.conversationId))
        .orderBy(asc(chatMessages.createdAt))
        .limit(input.limit);

      return messages;
    }),
} satisfies TRPCRouterRecord;
