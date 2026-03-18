import type { TRPCRouterRecord } from "@trpc/server";
import { desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { workItemSnapshots } from "@bob/db/schema";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";

export const snapshotRouter = {
  create: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        stage: z.string(),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ input }) => {
      const [snapshot] = await db
        .insert(workItemSnapshots)
        .values({
          workItemId: input.workItemId,
          stage: input.stage,
          data: input.data,
        })
        .returning();
      return snapshot;
    }),

  list: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
      }),
    )
    .query(async ({ input }) => {
      return db
        .select()
        .from(workItemSnapshots)
        .where(eq(workItemSnapshots.workItemId, input.workItemId))
        .orderBy(desc(workItemSnapshots.createdAt));
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const rows = await db
        .select()
        .from(workItemSnapshots)
        .where(eq(workItemSnapshots.id, input.id))
        .limit(1);
      return rows[0] ?? null;
    }),
} satisfies TRPCRouterRecord;
