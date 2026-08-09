import {
  AppendConversationEventInputV1Schema,
  AppendConversationEventResultV1Schema,
  ConversationEventListInputV1Schema,
  ConversationEventListPageV1Schema,
  CorrectConversationEventInputV1Schema,
} from "../../contracts/v1";
import {
  appendConversationEvent,
  correctConversationEvent,
  listConversationEventsCompatible,
} from "../../kernel";
import { rolloutProcedure } from "../trpc";
import { runKernel } from "./_kernel-error";

export const eventsRouter = {
  append: rolloutProcedure("mobile_text")
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/events",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(AppendConversationEventInputV1Schema)
    .output(AppendConversationEventResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => appendConversationEvent(ctx.db, ctx.userId, input)),
    ),

  correct: rolloutProcedure("mobile_text")
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/events/correct",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(CorrectConversationEventInputV1Schema)
    .output(AppendConversationEventResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => correctConversationEvent(ctx.db, ctx.userId, input)),
    ),

  paginate: rolloutProcedure("conversation_read")
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/events",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(ConversationEventListInputV1Schema)
    .output(ConversationEventListPageV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() =>
        listConversationEventsCompatible(ctx.db, ctx.userId, input),
      ),
    ),
} satisfies RouterRecord;
import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
