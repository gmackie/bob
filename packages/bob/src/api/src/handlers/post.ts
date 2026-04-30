/**
 * Post handler functions — pure business logic extracted from the tRPC
 * post router.
 *
 * Phase 7B-4D-beta Task 2.
 */
import { desc, eq } from "@bob/db";
import { Post } from "@bob/db/schema";

import type { HandlerContext, PublicHandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function postAll(ctx: PublicHandlerContext) {
  return ctx.db.query.Post.findMany({
    orderBy: desc(Post.id),
    limit: 10,
  });
}

export async function postById(
  ctx: PublicHandlerContext,
  input: { id: string },
) {
  return ctx.db.query.Post.findFirst({
    where: eq(Post.id, input.id),
  });
}

export async function postCreate(
  ctx: HandlerContext,
  input: { title: string; content: string },
) {
  return ctx.db.insert(Post).values(input);
}

export async function postDelete(ctx: HandlerContext, input: string) {
  return ctx.db.delete(Post).where(eq(Post.id, input));
}
