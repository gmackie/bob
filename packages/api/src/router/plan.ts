import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq, and } from "@bob/db";
import {
  worktreePlans,
  planTaskItems,
  worktrees,
  CreateWorktreePlanSchema,
  CreatePlanTaskItemSchema,
  planStatusEnum,
  taskStatusEnum,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

export const planRouter = {
  list: protectedProcedure
    .input(z.object({ worktreeId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(worktreePlans.userId, ctx.session.user.id)];
      if (input.worktreeId) {
        conditions.push(eq(worktreePlans.worktreeId, input.worktreeId));
      }

      const plans = await ctx.db.query.worktreePlans.findMany({
        where: and(...conditions),
        orderBy: desc(worktreePlans.createdAt),
        with: {
          tasks: true,
          worktree: true,
        },
      });
      return plans;
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const plan = await ctx.db.query.worktreePlans.findFirst({
        where: and(
          eq(worktreePlans.id, input.id),
          eq(worktreePlans.userId, ctx.session.user.id)
        ),
        with: {
          tasks: {
            orderBy: planTaskItems.sortOrder,
          },
          worktree: true,
        },
      });

      if (!plan) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
      }

      return plan;
    }),

  byWorktree: protectedProcedure
    .input(z.object({ worktreeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const wt = await ctx.db.query.worktrees.findFirst({
        where: and(
          eq(worktrees.id, input.worktreeId),
          eq(worktrees.userId, ctx.session.user.id)
        ),
      });

      if (!wt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
      }

      const plan = await ctx.db.query.worktreePlans.findFirst({
        where: and(
          eq(worktreePlans.worktreeId, input.worktreeId),
          eq(worktreePlans.userId, ctx.session.user.id)
        ),
        with: {
          tasks: {
            orderBy: planTaskItems.sortOrder,
          },
        },
      });

      return plan;
    }),

  create: protectedProcedure
    .input(CreateWorktreePlanSchema)
    .mutation(async ({ ctx, input }) => {
      const wt = await ctx.db.query.worktrees.findFirst({
        where: and(
          eq(worktrees.id, input.worktreeId),
          eq(worktrees.userId, ctx.session.user.id)
        ),
      });

      if (!wt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
      }

      const [plan] = await ctx.db
        .insert(worktreePlans)
        .values({
          ...input,
          userId: ctx.session.user.id,
        })
        .returning();

      return plan;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().max(256).optional(),
        goal: z.string().optional(),
        status: z.enum(planStatusEnum).optional(),
        kanbangerTaskId: z.string().max(100).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const existing = await ctx.db.query.worktreePlans.findFirst({
        where: and(
          eq(worktreePlans.id, id),
          eq(worktreePlans.userId, ctx.session.user.id)
        ),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
      }

      const [updated] = await ctx.db
        .update(worktreePlans)
        .set(updates)
        .where(eq(worktreePlans.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(worktreePlans)
        .where(
          and(
            eq(worktreePlans.id, input.id),
            eq(worktreePlans.userId, ctx.session.user.id)
          )
        );
      return { success: true };
    }),

  syncFromFile: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.db.query.worktreePlans.findFirst({
        where: and(
          eq(worktreePlans.id, input.id),
          eq(worktreePlans.userId, ctx.session.user.id)
        ),
      });

      if (!plan) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
      }

      await ctx.db
        .update(worktreePlans)
        .set({ lastSyncedAt: new Date() })
        .where(eq(worktreePlans.id, input.id));

      return { success: true };
    }),

  addTask: protectedProcedure
    .input(CreatePlanTaskItemSchema)
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.db.query.worktreePlans.findFirst({
        where: and(
          eq(worktreePlans.id, input.planId),
          eq(worktreePlans.userId, ctx.session.user.id)
        ),
      });

      if (!plan) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
      }

      const [task] = await ctx.db
        .insert(planTaskItems)
        .values(input)
        .returning();

      return task;
    }),

  updateTask: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        content: z.string().optional(),
        status: z.enum(taskStatusEnum).optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        sortOrder: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      const task = await ctx.db.query.planTaskItems.findFirst({
        where: eq(planTaskItems.id, id),
        with: { plan: true },
      });

      if (!task || task.plan.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      const updateData: Record<string, unknown> = { ...updates };
      if (updates.status === "completed") {
        updateData.completedAt = new Date();
      }

      const [updated] = await ctx.db
        .update(planTaskItems)
        .set(updateData)
        .where(eq(planTaskItems.id, id))
        .returning();

      return updated;
    }),

  deleteTask: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.query.planTaskItems.findFirst({
        where: eq(planTaskItems.id, input.id),
        with: { plan: true },
      });

      if (!task || task.plan.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      await ctx.db.delete(planTaskItems).where(eq(planTaskItems.id, input.id));
      return { success: true };
    }),

  reorderTasks: protectedProcedure
    .input(
      z.object({
        planId: z.string().uuid(),
        taskIds: z.array(z.string().uuid()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.db.query.worktreePlans.findFirst({
        where: and(
          eq(worktreePlans.id, input.planId),
          eq(worktreePlans.userId, ctx.session.user.id)
        ),
      });

      if (!plan) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
      }

      await Promise.all(
        input.taskIds.map((taskId, index) =>
          ctx.db
            .update(planTaskItems)
            .set({ sortOrder: index })
            .where(eq(planTaskItems.id, taskId))
        )
      );

      return { success: true };
    }),
} satisfies TRPCRouterRecord;
