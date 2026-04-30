import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import { captureListTargets, captureCapture } from "../handlers/capture";

export const captureRouter = {
  listTargets: protectedProcedure.query(({ ctx }) =>
    captureListTargets({ db: ctx.db, userId: ctx.session.user.id }),
  ),

  capture: protectedProcedure
    .input(
      z.object({
        targetType: z.enum(["browser", "window", "screen"]),
        targetId: z.string().optional(),
        url: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      captureCapture({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
