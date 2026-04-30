import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  requirementList,
  requirementCreate,
  requirementUpdate,
  requirementDelete,
  requirementLinkToTask,
} from "../handlers/requirement";

const categorySchema = z.enum([
  "data",
  "api",
  "ui",
  "infra",
  "test",
  "other",
]);
const statusSchema = z.enum(["pending", "in_progress", "done"]);

export const requirementRouter = {
  list: protectedProcedure
    .input(z.object({ workItemId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      requirementList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  create: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        category: categorySchema,
        description: z.string().min(1),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      requirementCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        description: z.string().min(1).optional(),
        status: statusSchema.optional(),
        category: categorySchema.optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      requirementUpdate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      requirementDelete({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  linkToTask: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        taskId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      requirementLinkToTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
