import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";

import {
  HermesCaptureInputV1Schema,
  HermesCaptureReceiptV1Schema,
} from "../../contracts/v1";
import { createHermesCaptureAdapter } from "../../integrations/hermes-capture";
import { appendConversationEvent } from "../../kernel";
import { rolloutProcedure } from "../trpc";
import { runKernel } from "./_kernel-error";

export const hermesRouter = {
  capture: rolloutProcedure("mobile_text")
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/hermes/capture",
        tags: ["ooda-v1", "hermes"],
        protect: true,
      },
    })
    .input(HermesCaptureInputV1Schema)
    .output(HermesCaptureReceiptV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() =>
        createHermesCaptureAdapter({
          append: (event) => appendConversationEvent(ctx.db, ctx.userId, event),
        }).capture(input),
      ),
    ),
} satisfies RouterRecord;
