import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq, and, asc } from "@bob/db";
import {
  chatAttachments,
  chatConversations,
  chatMessages,
  messageRoleEnum,
  repositories,
  workItems,
  workspaceMembers,
  worktrees,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3002";

async function loadAccessibleWorkItem(db: any, userId: string, workItemId: string) {
  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
    columns: { id: true, workspaceId: true },
  });

  if (!workItem?.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Work item not found" });
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

async function loadOwnedRepository(db: any, userId: string, repositoryId: string) {
  const repository = await db.query.repositories.findFirst({
    where: and(
      eq(repositories.id, repositoryId),
      eq(repositories.userId, userId),
    ),
    columns: { id: true },
  });

  if (!repository) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
  }

  return repository;
}

async function loadOwnedWorktree(db: any, userId: string, worktreeId: string) {
  const worktree = await db.query.worktrees.findFirst({
    where: and(eq(worktrees.id, worktreeId), eq(worktrees.userId, userId)),
    columns: { id: true },
  });

  if (!worktree) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
  }

  return worktree;
}

async function loadOwnedConversation(db: any, userId: string, conversationId: string) {
  const conversation = await db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, conversationId),
      eq(chatConversations.userId, userId),
    ),
  });

  if (!conversation) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
  }

  return conversation;
}

async function loadOwnedMessage(db: any, userId: string, messageId: string) {
  const message = await db.query.chatMessages.findFirst({
    where: eq(chatMessages.id, messageId),
    with: {
      conversation: true,
    },
  });

  if (!message || message.conversation?.userId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
  }

  return message;
}

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
        sessionType: z.string().max(20).optional(),
        workItemId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.repositoryId) {
        await loadOwnedRepository(ctx.db, ctx.session.user.id, input.repositoryId);
      }
      if (input.worktreeId) {
        await loadOwnedWorktree(ctx.db, ctx.session.user.id, input.worktreeId);
      }
      if (input.workItemId) {
        await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);
      }

      const [conversation] = await ctx.db
        .insert(chatConversations)
        .values({
          userId: ctx.session.user.id,
          repositoryId: input.repositoryId ?? null,
          worktreeId: input.worktreeId ?? null,
          workingDirectory: input.workingDirectory ?? null,
          title: input.title ?? null,
          ...(input.sessionType ? { sessionType: input.sessionType } : {}),
          ...(input.workItemId ? { workItemId: input.workItemId } : {}),
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
      const conversation = await loadOwnedConversation(
        ctx.db,
        ctx.session.user.id,
        input.conversationId,
      );

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
      await loadOwnedConversation(ctx.db, ctx.session.user.id, input.conversationId);

      const messages = await ctx.db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, input.conversationId))
        .orderBy(asc(chatMessages.createdAt))
        .limit(input.limit);

      return messages;
    }),
  attachImage: protectedProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        url: z.string(),
        filename: z.string().optional(),
        mimeType: z.string().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        sizeBytes: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await loadOwnedMessage(ctx.db, ctx.session.user.id, input.messageId);

      const [attachment] = await ctx.db
        .insert(chatAttachments)
        .values({
          messageId: input.messageId,
          type: "image",
          url: input.url,
          filename: input.filename ?? null,
          mimeType: input.mimeType ?? null,
          width: input.width ?? null,
          height: input.height ?? null,
          sizeBytes: input.sizeBytes ?? null,
        })
        .returning();

      return attachment;
    }),

  getAttachments: protectedProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await loadOwnedMessage(ctx.db, ctx.session.user.id, input.messageId);

      const attachments = await ctx.db
        .select()
        .from(chatAttachments)
        .where(eq(chatAttachments.messageId, input.messageId))
        .orderBy(asc(chatAttachments.createdAt));

      return attachments;
    }),
} satisfies TRPCRouterRecord;
