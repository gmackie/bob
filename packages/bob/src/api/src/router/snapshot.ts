import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  snapshotCreate,
  snapshotList,
  snapshotGet,
} from "../handlers/snapshot";

export const snapshotRouter = {
  create: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        stage: z.string(),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(({ ctx, input }) =>
      snapshotCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  list: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      snapshotList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      snapshotGet({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
