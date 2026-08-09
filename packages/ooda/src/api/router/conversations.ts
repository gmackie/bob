import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

import {
  ArchiveConversationInputV1Schema,
  ArchiveConversationResultV1Schema,
  ConversationDetailV1Schema,
  ConversationListInputV1Schema,
  ConversationListPageV1Schema,
  CreateConversationInputV1Schema,
  CreateConversationResultV1Schema,
  ForkConversationInputV1Schema,
  ForkConversationResultV1Schema,
} from "../../contracts/v1";
import {
  archiveConversation,
  createConversation,
  forkConversation,
  getConversationCompatible,
  listConversations,
} from "../../kernel";
import { rolloutProcedure } from "../trpc";
import { runKernel } from "./_kernel-error";

export const conversationsRouter = {
  list: rolloutProcedure("conversation_read")
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/conversations",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(ConversationListInputV1Schema)
    .output(ConversationListPageV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() => listConversations(ctx.db, ctx.userId, input)),
    ),

  create: rolloutProcedure("conversation_write")
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/conversations",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(CreateConversationInputV1Schema)
    .output(CreateConversationResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => createConversation(ctx.db, ctx.userId, input)),
    ),

  retrieve: rolloutProcedure("conversation_read")
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/conversations/retrieve",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(z.object({ conversationId: z.string().min(1) }).strict())
    .output(ConversationDetailV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() =>
        getConversationCompatible(ctx.db, ctx.userId, input.conversationId),
      ),
    ),

  fork: rolloutProcedure("conversation_write")
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/conversations/fork",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(ForkConversationInputV1Schema)
    .output(ForkConversationResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => forkConversation(ctx.db, ctx.userId, input)),
    ),

  archive: rolloutProcedure("conversation_write")
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/conversations/archive",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(ArchiveConversationInputV1Schema)
    .output(ArchiveConversationResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => archiveConversation(ctx.db, ctx.userId, input)),
    ),
} satisfies RouterRecord;
