/**
 * Effect-RPC handler functions for the post RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 2.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  postAll,
  postById,
  postCreate,
  postDelete,
} from "../handlers/post.js";

export const makePostRpcHandlers = (ctx: HandlerContext) => ({
  "post.all": ({ payload }: { payload: void }) =>
    wrapHandler(
      (c, _input: void) => postAll({ db: c.db, session: null }),
      ctx,
      payload,
      "post",
    ),

  "post.byId": ({
    payload,
  }: {
    payload: { id: string };
  }) =>
    wrapHandler(
      (c, input: { id: string }) => postById({ db: c.db, session: null }, input),
      ctx,
      payload,
      "post",
    ),

  "post.create": ({
    payload,
  }: {
    payload: { title: string; content: string };
  }) => wrapHandler(postCreate, ctx, payload, "post"),

  "post.delete": ({
    payload,
  }: {
    payload: string;
  }) => wrapHandler(postDelete, ctx, payload, "post"),
});
