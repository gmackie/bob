/**
 * Effect-RPC handler functions for the snapshot planning RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D Task 4.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  snapshotCreate,
  snapshotList,
  snapshotGet,
} from "../handlers/snapshot.js";

export const makeSnapshotRpcHandlers = (ctx: HandlerContext) => ({
  "planning.snapshot.create": ({
    payload,
  }: {
    payload: {
      workItemId: string;
      stage: string;
      data: Record<string, unknown>;
    };
  }) => wrapHandler(snapshotCreate, ctx, payload, "snapshot"),

  "planning.snapshot.list": ({
    payload,
  }: {
    payload: { workItemId: string };
  }) => wrapHandler(snapshotList, ctx, payload, "snapshot"),

  "planning.snapshot.get": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(snapshotGet, ctx, payload, "snapshot"),
});
