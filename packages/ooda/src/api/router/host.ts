import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";

import {
  ClaimHostTurnInputV1Schema,
  ClaimHostTurnResultV1Schema,
  CompleteHostTurnInputV1Schema,
  CreateHostTurnInputV1Schema,
  CreateHostTurnResultV1Schema,
  EnqueueHostTurnResultV1Schema,
  FailHostTurnInputV1Schema,
  FailHostTurnResultV1Schema,
} from "../../contracts/v1";
import {
  claimHostTurn,
  completeHostTurn,
  createConfiguredContextSources,
  enqueueHostTurn,
  failHostTurn,
  resolveContextSourceConfig,
} from "../../kernel";
import { authedProcedure, trustedRunnerProcedure } from "../trpc";
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
    .output(EnqueueHostTurnResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() =>
        enqueueHostTurn(ctx.db, ctx.userId, input, {
          contextSources: createConfiguredContextSources(
            resolveContextSourceConfig(process.env),
          ),
          signal: AbortSignal.timeout(30_000),
        }),
      ),
    ),
  claim: trustedRunnerProcedure
    .input(ClaimHostTurnInputV1Schema)
    .output(ClaimHostTurnResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => claimHostTurn(ctx.db, input)),
    ),
  complete: trustedRunnerProcedure
    .input(CompleteHostTurnInputV1Schema)
    .output(CreateHostTurnResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => completeHostTurn(ctx.db, input)),
    ),
  fail: trustedRunnerProcedure
    .input(FailHostTurnInputV1Schema)
    .output(FailHostTurnResultV1Schema)
    .mutation(({ ctx, input }) => runKernel(() => failHostTurn(ctx.db, input))),
} satisfies RouterRecord;
