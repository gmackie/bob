/**
 * Chat handler functions — pure business logic extracted from the tRPC
 * chat router.
 *
 * Phase 7B-4D-beta Task 4.
 */
import { TRPCError } from "@trpc/server";
import { desc, eq, and, asc } from "@bob/db";
import type { Db } from "@bob/db/client";
import {
  chatAttachments,
  chatConversations,
  chatMessages,
  repositories,
  workItems,
  workspaceMembers,
  worktrees,
} from "@bob/db/schema";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helpers (moved verbatim from the router)
// ---------------------------------------------------------------------------

async function loadAccessibleWorkItem(db: Db, userId: string, workItemId: string) {
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

async function loadOwnedRepository(db: Db, userId: string, repositoryId: string) {
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

async function loadOwnedWorktree(db: Db, userId: string, worktreeId: string) {
  const worktree = await db.query.worktrees.findFirst({
    where: and(eq(worktrees.id, worktreeId), eq(worktrees.userId, userId)),
    columns: { id: true },
  });

  if (!worktree) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
  }

  return worktree;
}

async function loadOwnedConversation(db: Db, userId: string, conversationId: string) {
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

async function loadOwnedMessage(db: Db, userId: string, messageId: string) {
  const message = await db.query.chatMessages.findFirst({
    where: eq(chatMessages.id, messageId),
    with: {
      conversation: true,
    },
  });

  if (message?.conversation.userId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
  }

  return message;
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function chatListConversations(
  ctx: HandlerContext,
  input: { repositoryId?: string; limit: number },
) {
  const conditions = [eq(chatConversations.userId, ctx.userId)];

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
}

export async function chatGetConversation(
  ctx: HandlerContext,
  input: { id: string },
) {
  const conversation = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.id),
      eq(chatConversations.userId, ctx.userId),
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
}

export async function chatCreateConversation(
  ctx: HandlerContext,
  input: {
    repositoryId?: string;
    worktreeId?: string;
    workingDirectory?: string;
    title?: string;
    sessionType?: string;
    workItemId?: string;
  },
) {
  if (input.repositoryId) {
    await loadOwnedRepository(ctx.db, ctx.userId, input.repositoryId);
  }
  if (input.worktreeId) {
    await loadOwnedWorktree(ctx.db, ctx.userId, input.worktreeId);
  }
  if (input.workItemId) {
    await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);
  }

  const [conversation] = await ctx.db
    .insert(chatConversations)
    .values({
      userId: ctx.userId,
      repositoryId: input.repositoryId ?? null,
      worktreeId: input.worktreeId ?? null,
      workingDirectory: input.workingDirectory ?? null,
      title: input.title ?? null,
      ...(input.sessionType ? { sessionType: input.sessionType } : {}),
      ...(input.workItemId ? { workItemId: input.workItemId } : {}),
    })
    .returning();

  return conversation;
}

export async function chatDeleteConversation(
  ctx: HandlerContext,
  input: { id: string },
) {
  await ctx.db
    .delete(chatConversations)
    .where(
      and(
        eq(chatConversations.id, input.id),
        eq(chatConversations.userId, ctx.userId),
      ),
    );
  return { success: true };
}

export async function chatSendMessage(
  ctx: HandlerContext,
  input: { conversationId: string; content: string },
) {
  await loadOwnedConversation(
    ctx.db,
    ctx.userId,
    input.conversationId,
  );

  // Persist the user message in the DB. Not returned below (this endpoint
  // always throws NOT_IMPLEMENTED next) — kept as a real insert rather than
  // removed, since the write itself is the behavior other code may depend
  // on even though the response is an error; only the local binding to the
  // inserted row is unused.
  const [_userMessage] = await ctx.db
    .insert(chatMessages)
    .values({
      conversationId: input.conversationId,
      role: "user",
      content: input.content,
    })
    .returning();

  // Chat input delivery now goes through the WS connection (BobWsClient.sendInput),
  // not through this tRPC endpoint. Return the saved message so callers can migrate.
  throw new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Chat messages are delivered via WebSocket. Use the WS connection to send input to a running session.",
  });
}

export async function chatGetMessages(
  ctx: HandlerContext,
  input: { conversationId: string; limit: number; before?: string },
) {
  await loadOwnedConversation(ctx.db, ctx.userId, input.conversationId);

  const messages = await ctx.db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, input.conversationId))
    .orderBy(asc(chatMessages.createdAt))
    .limit(input.limit);

  return messages;
}

export async function chatAttachImage(
  ctx: HandlerContext,
  input: {
    messageId: string;
    url: string;
    filename?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    sizeBytes?: number;
  },
) {
  await loadOwnedMessage(ctx.db, ctx.userId, input.messageId);

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
}

export async function chatGetAttachments(
  ctx: HandlerContext,
  input: { messageId: string },
) {
  await loadOwnedMessage(ctx.db, ctx.userId, input.messageId);

  const attachments = await ctx.db
    .select()
    .from(chatAttachments)
    .where(eq(chatAttachments.messageId, input.messageId))
    .orderBy(asc(chatAttachments.createdAt));

  return attachments;
}
