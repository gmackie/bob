/**
 * Effect-RPC handler functions for the dispatch RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 5.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  dispatchCreateBatch,
  dispatchGetBatch,
  dispatchUpdateItemAgent,
  dispatchUpdateConcurrency,
  dispatchDispatch,
  dispatchCheckProgress,
  dispatchListBatches,
  dispatchResetPipelineState,
} from "../handlers/dispatch.js";

export const makeDispatchRpcHandlers = (ctx: HandlerContext) => ({
  "dispatch.createBatch": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      concurrency: number;
      tasks: Array<{
        draftId: string;
        taskId: string;
        identifier: string;
      }>;
    };
  }) => wrapHandler(dispatchCreateBatch, ctx, payload, "dispatch"),

  "dispatch.getBatch": ({
    payload,
  }: {
    payload: { batchId: string };
  }) => wrapHandler(dispatchGetBatch, ctx, payload, "dispatch"),

  "dispatch.updateItemAgent": ({
    payload,
  }: {
    payload: { itemId: string; agentType: string };
  }) => wrapHandler(dispatchUpdateItemAgent, ctx, payload, "dispatch"),

  "dispatch.updateConcurrency": ({
    payload,
  }: {
    payload: { batchId: string; concurrency: number };
  }) => wrapHandler(dispatchUpdateConcurrency, ctx, payload, "dispatch"),

  "dispatch.dispatch": ({
    payload,
  }: {
    payload: { batchId: string };
  }) => wrapHandler(dispatchDispatch, ctx, payload, "dispatch"),

  "dispatch.checkProgress": ({
    payload,
  }: {
    payload: { batchId: string };
  }) => wrapHandler(dispatchCheckProgress, ctx, payload, "dispatch"),

  "dispatch.listBatches": ({
    payload,
  }: {
    payload: { status?: string; limit: number };
  }) => wrapHandler(dispatchListBatches, ctx, payload, "dispatch"),

  "dispatch.resetPipelineState": ({
    payload,
  }: {
    payload: { itemId: string };
  }) => wrapHandler(dispatchResetPipelineState, ctx, payload, "dispatch"),
});
