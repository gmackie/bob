import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";

import {
  ContextPackV1Schema,
  GetContextPackInputV1Schema,
} from "../../contracts/v1";
import { getContextPack } from "../../kernel";
import { authedProcedure } from "../trpc";
import { runKernel } from "./_kernel-error";

export const contextRouter = {
  get: authedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/context-packs/{id}",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(GetContextPackInputV1Schema)
    .output(ContextPackV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() => getContextPack(ctx.db, ctx.userId, input.id)),
    ),
} satisfies RouterRecord;
