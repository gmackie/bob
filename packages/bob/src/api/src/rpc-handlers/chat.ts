/**
 * Effect-RPC handler functions for the chat RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 4.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  chatListConversations,
  chatGetConversation,
  chatCreateConversation,
  chatDeleteConversation,
  chatSendMessage,
  chatGetMessages,
  chatAttachImage,
  chatGetAttachments,
} from "../handlers/chat.js";

export const makeChatRpcHandlers = (ctx: HandlerContext) => ({
  "chat.listConversations": ({
    payload,
  }: {
    payload: { repositoryId?: string; limit: number };
  }) => wrapHandler(chatListConversations, ctx, payload, "chat"),

  "chat.getConversation": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(chatGetConversation, ctx, payload, "chat"),

  "chat.createConversation": ({
    payload,
  }: {
    payload: {
      repositoryId?: string;
      worktreeId?: string;
      workingDirectory?: string;
      title?: string;
      sessionType?: string;
      workItemId?: string;
    };
  }) => wrapHandler(chatCreateConversation, ctx, payload, "chat"),

  "chat.deleteConversation": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(chatDeleteConversation, ctx, payload, "chat"),

  "chat.sendMessage": ({
    payload,
  }: {
    payload: { conversationId: string; content: string };
  }) => wrapHandler(chatSendMessage, ctx, payload, "chat"),

  "chat.getMessages": ({
    payload,
  }: {
    payload: { conversationId: string; limit: number; before?: string };
  }) => wrapHandler(chatGetMessages, ctx, payload, "chat"),

  "chat.attachImage": ({
    payload,
  }: {
    payload: {
      messageId: string;
      url: string;
      filename?: string;
      mimeType?: string;
      width?: number;
      height?: number;
      sizeBytes?: number;
    };
  }) => wrapHandler(chatAttachImage, ctx, payload, "chat"),

  "chat.getAttachments": ({
    payload,
  }: {
    payload: { messageId: string };
  }) => wrapHandler(chatGetAttachments, ctx, payload, "chat"),
});
