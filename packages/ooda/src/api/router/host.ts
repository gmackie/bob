import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";

import {
  CreateHostTurnInputV1Schema,
  CreateHostTurnResultV1Schema,
} from "../../contracts/v1";
import { createHostProviderClients, createHostTurn } from "../../kernel";
import { authedProcedure } from "../trpc";
import { runKernel } from "./_kernel-error";

export const hostRouter = {
  createTurn: authedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/host-turns",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(CreateHostTurnInputV1Schema)
    .output(CreateHostTurnResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() =>
        createHostTurn(ctx.db, ctx.userId, input, {
          providers: createHostProviderClients({
            xaiApiKey: process.env.XAI_API_KEY,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY,
            openaiApiKey: process.env.OPENAI_API_KEY,
            grokModel: process.env.OODA_GROK_HOST_MODEL,
            claudeModel: process.env.OODA_CLAUDE_HOST_MODEL,
            openaiModel: process.env.OODA_OPENAI_HOST_MODEL,
          }),
          signal: AbortSignal.timeout(90_000),
        }),
      ),
    ),
} satisfies RouterRecord;
