import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  chatListConversations,
  chatGetConversation,
  chatCreateConversation,
  chatDeleteConversation,
  chatSendMessage,
  chatGetMessages,
  chatAttachImage,
  chatGetAttachments,
} from "../handlers/chat";

export const chatRouter = {
  listConversations: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(({ ctx, input }) =>
      chatListConversations({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getConversation: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      chatGetConversation({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      chatCreateConversation({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  deleteConversation: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      chatDeleteConversation({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  sendMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        content: z.string().min(1),
      })
    )
    .mutation(({ ctx, input }) =>
      chatSendMessage({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getMessages: protectedProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        limit: z.number().min(1).max(200).default(100),
        before: z.string().uuid().optional(),
      })
    )
    .query(({ ctx, input }) =>
      chatGetMessages({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      chatAttachImage({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getAttachments: protectedProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      chatGetAttachments({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
