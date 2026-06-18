/**
 * Effect-RPC handler functions for the auth RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 2.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import { authGetSession, authGetSecretMessage } from "../handlers/auth.js";

export const makeAuthRpcHandlers = (ctx: HandlerContext) => ({
  "auth.getSession": ({ payload }: { payload: void }) =>
    wrapHandler(
      (c, _input: void) => authGetSession({ db: c.db, session: null }),
      ctx,
      payload,
      "auth",
    ),

  "auth.getSecretMessage": ({ payload }: { payload: void }) =>
    wrapHandler(
      (_c, _input: void) => authGetSecretMessage(),
      ctx,
      payload,
      "auth",
    ),
});
