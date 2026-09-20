import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import { PROXY_CONTROL_ACTIONS, proxyControlSet } from "../handlers/proxyControl";

export const proxyControlRouter = {
  /**
   * Act on the inference proxy behind the workspace host: refresh, enable or
   * disable an account, or test the connection. The proxy's answer comes back
   * asynchronously as a `proxy_control_result` frame on the workspace socket,
   * followed by a fresh host snapshot.
   */
  set: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        action: z.enum(PROXY_CONTROL_ACTIONS),
        accountId: z.string().min(1).max(256).optional(),
        requestId: z.string().min(8).max(64),
      }),
    )
    .mutation(({ ctx, input }) =>
      proxyControlSet({ db: ctx.db, userId: ctx.session.user.id } as never, input),
    ),
} satisfies TRPCRouterRecord;
