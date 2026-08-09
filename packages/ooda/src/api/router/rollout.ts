import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

import {
  OodaRolloutPolicyV1Schema,
  ProductionReadinessSnapshotV1Schema,
} from "../../contracts/v1";
import { getProductionReadiness, resolveOodaRolloutPolicy } from "../../kernel";
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
  readiness: authedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/readiness",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(z.object({}).strict())
    .output(ProductionReadinessSnapshotV1Schema)
    .query(({ ctx }) => getProductionReadiness(ctx.db, ctx.userId)),
} satisfies RouterRecord;
