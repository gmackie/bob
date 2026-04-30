import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  checkpointCreate,
  checkpointList,
  checkpointBranchFrom,
} from "../handlers/checkpoint";

export const checkpointRouter = {
  create: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        turnNumber: z.number().int().min(0),
        eventSeq: z.number().int().min(0),
        label: z.string().optional(),
        snapshotData: z.record(z.string(), z.unknown()).default({}),
        gitRef: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      checkpointCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  list: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      checkpointList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  branchFrom: protectedProcedure
    .input(z.object({ checkpointId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      checkpointBranchFrom({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
