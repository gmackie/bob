import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

import { OodaRolloutPolicyV1Schema } from "../../contracts/v1";
import { resolveOodaRolloutPolicy } from "../../kernel";
import { authedProcedure } from "../trpc";

export const rolloutRouter = {
  status: authedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/rollout",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(z.object({}).strict())
    .output(OodaRolloutPolicyV1Schema)
    .query(({ ctx }) => resolveOodaRolloutPolicy(ctx.userId)),
} satisfies RouterRecord;
