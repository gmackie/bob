import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  dispatchCreateBatch,
  dispatchGetBatch,
  dispatchUpdateItemAgent,
  dispatchUpdateConcurrency,
  dispatchDispatch,
  dispatchCheckProgress,
  dispatchListBatches,
  dispatchResetPipelineState,
  dispatchExecutionBatch,
} from "../handlers/dispatch";

export const dispatchRouter = {
  /**
   * Create a dispatch batch from committed plan drafts.
   * Call this after commitPlan — pass the task mappings returned by commitPlan.
   */
  createBatch: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        concurrency: z.number().int().min(1).max(10).default(2),
        tasks: z.array(
          z.object({
            draftId: z.string().uuid(),
            taskId: z.string(),
            identifier: z.string(),
          }),
        ),
      }),
    )
    .mutation(({ ctx, input }) =>
      dispatchCreateBatch({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Get a batch with all its items. */
  getBatch: protectedProcedure
    .input(z.object({ batchId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      dispatchGetBatch({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Update the agent type for a dispatch item. */
  updateItemAgent: protectedProcedure
    .input(
      z.object({
        itemId: z.string().uuid(),
        agentType: z.string().min(1).max(50),
      }),
    )
    .mutation(({ ctx, input }) =>
      dispatchUpdateItemAgent({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Update the concurrency limit for a batch. */
  updateConcurrency: protectedProcedure
    .input(
      z.object({
        batchId: z.string().uuid(),
        concurrency: z.number().int().min(1).max(10),
      }),
    )
    .mutation(({ ctx, input }) =>
      dispatchUpdateConcurrency({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Start dispatching a batch — execute queued items up to concurrency limit. */
  dispatch: protectedProcedure
    .input(z.object({ batchId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      dispatchDispatch({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Check progress: update item statuses, unblock dependents, start next wave. */
  checkProgress: protectedProcedure
    .input(z.object({ batchId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      dispatchCheckProgress({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** List dispatch batches for the current user, optionally filtered by status. */
  listBatches: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(5),
      }),
    )
    .query(({ ctx, input }) =>
      dispatchListBatches({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  /** Reset a dispatch item's pipeline state to agent_complete (re-triggers build). */
  resetPipelineState: protectedProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      dispatchResetPipelineState({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
  /**
   * Dispatch work items directly as execution sessions — no plan drafts needed.
   * Takes existing work item IDs or inline task descriptions.
   */
  executionBatch: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        agentType: z.string().min(1).max(50).default("claude"),
        concurrency: z.number().int().min(1).max(10).default(2),
        items: z.array(
          z.object({
            workItemId: z.string().uuid().optional(),
            title: z.string().max(256).optional(),
            description: z.string().optional(),
          }),
        ).min(1).max(50),
      }),
    )
    .mutation(({ ctx, input }) =>
      dispatchExecutionBatch({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
