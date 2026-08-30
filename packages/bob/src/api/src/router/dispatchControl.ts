import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import { DISPATCH_ACTIONS, dispatchControlSet } from "../handlers/dispatchControl";

export const dispatchControlRouter = {
  /**
   * Start or stop the workspace host's task runner.
   *
   * The confirmed state comes back asynchronously as a `dispatch_state` frame
   * on the workspace socket — this mutation only reports that the command
   * reached the daemon.
   */
  set: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        action: z.enum(DISPATCH_ACTIONS),
        requestId: z.string().min(8).max(64),
      }),
    )
    .mutation(({ ctx, input }) =>
      dispatchControlSet({ db: ctx.db, userId: ctx.session.user.id } as never, input),
    ),
} satisfies TRPCRouterRecord;
