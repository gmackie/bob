/**
 * Effect-RPC handler functions for the checkpoint RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 2.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  checkpointCreate,
  checkpointList,
  checkpointBranchFrom,
} from "../handlers/checkpoint.js";

export const makeCheckpointRpcHandlers = (ctx: HandlerContext) => ({
  "checkpoint.create": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      turnNumber: number;
      eventSeq: number;
      label?: string;
      snapshotData: Record<string, unknown>;
      gitRef?: string;
    };
  }) => wrapHandler(checkpointCreate, ctx, payload, "checkpoint"),

  "checkpoint.list": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(checkpointList, ctx, payload, "checkpoint"),

  "checkpoint.branchFrom": ({
    payload,
  }: {
    payload: { checkpointId: string };
  }) => wrapHandler(checkpointBranchFrom, ctx, payload, "checkpoint"),
});
