/**
 * Effect-RPC handler functions for the system RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 2.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import { systemHealth, systemStatus } from "../handlers/system.js";

export const makeSystemRpcHandlers = (ctx: HandlerContext) => ({
  "system.health": ({ payload }: { payload: void }) =>
    wrapHandler(
      (c, _input: void) => systemHealth({ db: c.db, session: null }),
      ctx,
      payload,
      "system",
    ),

  "system.status": ({ payload }: { payload: void }) =>
    wrapHandler(systemStatus, ctx, payload as any, "system"),
});
