import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import {
  CreateWorktreePlanSchema,
  CreatePlanTaskItemSchema,
  planStatusEnum,
  taskStatusEnum,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";
import {
  planList,
  planById,
  planByWorktree,
  planCreate,
  planUpdate,
  planDelete,
  planSyncFromFile,
  planAddTask,
  planUpdateTask,
  planDeleteTask,
  planReorderTasks,
} from "../handlers/plan";

export const planRouter = {
  list: protectedProcedure
    .input(z.object({ worktreeId: z.string().uuid().optional() }))
    .query(({ ctx, input }) =>
      planList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      planById({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  byWorktree: protectedProcedure
    .input(z.object({ worktreeId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      planByWorktree({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  create: protectedProcedure
    .input(CreateWorktreePlanSchema)
    .mutation(({ ctx, input }) =>
      planCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().max(256).optional(),
        goal: z.string().optional(),
        status: z.enum(planStatusEnum).optional(),
        planningTaskId: z.string().max(100).optional().nullable(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planUpdate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      planDelete({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  syncFromFile: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      planSyncFromFile({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  addTask: protectedProcedure
    .input(CreatePlanTaskItemSchema)
    .mutation(({ ctx, input }) =>
      planAddTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  updateTask: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        content: z.string().optional(),
        status: z.enum(taskStatusEnum).optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      planUpdateTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  deleteTask: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      planDeleteTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  reorderTasks: protectedProcedure
    .input(
      z.object({
        planId: z.string().uuid(),
        taskIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(({ ctx, input }) =>
      planReorderTasks({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
