/**
 * Post handler functions — pure business logic extracted from the tRPC
 * post router.
 *
 * NOTE: The `Post` demo table (the t3 starter example) was removed from
 * `@bob/db/schema` during the schema migration, so these endpoints no longer
 * have a backing table. They are retained as not-implemented stubs because the
 * `agent.post.*` contract procedures still reference them; the tRPC `postRouter`
 * that also used them is dead code (imported nowhere).
 *
 * Phase 7B-4D-beta Task 2.
 */
import { TRPCError } from "@trpc/server";

import type { HandlerContext, PublicHandlerContext } from "./context.js";

const removed = (): never => {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "The post demo table was removed from the schema.",
  });
};

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

// Kept `async` on all four (no real await — the backing table is gone) since
// rpc-handlers/post.ts wraps these via wrapHandler, which requires a
// Promise-returning fn.
export async function postAll(_ctx: PublicHandlerContext) {
  await Promise.resolve();
  return [] as { id: string; title: string; content: string }[];
}

export async function postById(
  _ctx: PublicHandlerContext,
  _input: { id: string },
) {
  await Promise.resolve();
  return undefined as
    | { id: string; title: string; content: string }
    | undefined;
}

export async function postCreate(
  _ctx: HandlerContext,
  _input: { title: string; content: string },
) {
  await Promise.resolve();
  return removed();
}

export async function postDelete(_ctx: HandlerContext, _input: string) {
  await Promise.resolve();
  return removed();
}
