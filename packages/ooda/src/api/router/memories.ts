import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";

import {
  InspectMemoryInputV1Schema,
  MemoryDetailV1Schema,
  MemorySearchInputV1Schema,
  MemorySearchPageV1Schema,
  SubmitMemoryFeedbackInputV1Schema,
  SubmitMemoryFeedbackResultV1Schema,
} from "../../contracts/v1";
import {
  inspectMemory,
  searchMemories,
  submitMemoryFeedback,
} from "../../kernel";
import { authedProcedure } from "../trpc";
import { runKernel } from "./_kernel-error";

export const memoriesRouter = {
  search: authedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/memories",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(MemorySearchInputV1Schema)
    .output(MemorySearchPageV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() => searchMemories(ctx.db, ctx.userId, input)),
    ),
  inspect: authedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/memories/{memoryId}",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(InspectMemoryInputV1Schema)
    .output(MemoryDetailV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() => inspectMemory(ctx.db, ctx.userId, input.memoryId)),
    ),
  feedback: authedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/memories/edges/{edgeId}/feedback",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(SubmitMemoryFeedbackInputV1Schema)
    .output(SubmitMemoryFeedbackResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => submitMemoryFeedback(ctx.db, ctx.userId, input)),
    ),
} satisfies RouterRecord;
