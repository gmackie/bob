import { TRPCError } from "@trpc/server";

import { eq } from "@gmacko/ooda/db";
import { researchThread } from "@gmacko/ooda/db/schema";

import { authedProcedure, t } from "../trpc";

/**
 * Thread-ownership middleware. Reads `threadId` from raw input, looks up
 * the thread's `ownerId`, and rejects if the authenticated user doesn't
 * match.
 *
 * Legacy threads (ownerId = null) remain accessible to any authed user
 * until backfilled.
 *
 * This middleware is designed to be stacked after `authedProcedure`, so
 * `ctx.userId` is guaranteed by the auth layer. It uses `getRawInput()`
 * because the middleware runs before the procedure's `.input()` parser.
 */
export const withThreadOwnership = t.middleware(
  async ({ ctx, next, getRawInput }) => {
    const raw = await getRawInput();
    const threadId = (raw as { threadId?: string } | undefined)?.threadId;
    if (!threadId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "threadId is required for this procedure",
      });
    }

    const thread = await ctx.db
      .select({ ownerId: researchThread.ownerId })
      .from(researchThread)
      .where(eq(researchThread.id, threadId))
      .limit(1);

    const row = thread[0];
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Thread not found" });
    }

    // null ownerId = legacy unowned thread — any authed user can access
    const userId = (ctx as typeof ctx & { userId: string }).userId;
    if (row.ownerId !== null && row.ownerId !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not own this thread",
      });
    }

    return next({ ctx: { ...ctx, threadId } });
  },
);

export const threadOwnerProcedure = authedProcedure.use(withThreadOwnership);
