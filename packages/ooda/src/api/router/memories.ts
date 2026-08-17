import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";

import {
  InspectMemoryInputV1Schema,
  AttentionReviewV1Schema,
  CreateOpportunityReviewInputV1Schema,
  CreateOpportunityReviewResultV1Schema,
  GetAttentionReviewInputV1Schema,
  MemoryDetailV1Schema,
  MemorySearchInputV1Schema,
  MemorySearchPageV1Schema,
  SubmitMemoryFeedbackInputV1Schema,
  SubmitMemoryFeedbackResultV1Schema,
} from "../../contracts/v1";
import {
  inspectMemory,
  createOpportunityReview,
  getAttentionReview,
  searchMemories,
  submitMemoryFeedback,
} from "../../kernel";
import { rolloutProcedure } from "../trpc";
import { runKernel } from "./_kernel-error";

export const memoriesRouter = {
  search: rolloutProcedure("conversation_read")
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
  inspect: rolloutProcedure("conversation_read")
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
  feedback: rolloutProcedure("conversation_write")
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
  createOpportunityReview: rolloutProcedure("portfolio_evidence")
    .meta({
      openapi: {
        method: "POST",
        path: "/api/v1/opportunity-reviews",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(CreateOpportunityReviewInputV1Schema)
    .output(CreateOpportunityReviewResultV1Schema)
    .mutation(({ ctx, input }) =>
      runKernel(() => createOpportunityReview(ctx.db, ctx.userId, input)),
    ),
  getOpportunityReview: rolloutProcedure("conversation_read")
    .meta({
      openapi: {
        method: "GET",
        path: "/api/v1/opportunity-reviews/{reviewId}",
        tags: ["ooda-v1"],
        protect: true,
      },
    })
    .input(GetAttentionReviewInputV1Schema)
    .output(AttentionReviewV1Schema)
    .query(({ ctx, input }) =>
      runKernel(() => getAttentionReview(ctx.db, ctx.userId, input.reviewId)),
    ),
} satisfies RouterRecord;
