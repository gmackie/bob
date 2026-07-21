/**
 * Plan handler functions — pure business logic extracted from the tRPC
 * plan router.
 *
 * Phase 7B-4D-beta Task 6.
 */
import { TRPCError } from "@trpc/server";
import { desc, eq, and } from "@bob/db";
import {
  worktreePlans,
  planTaskItems,
  worktrees,
} from "@bob/db/schema";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function planList(
  ctx: HandlerContext,
  input: { worktreeId?: string },
) {
  const conditions = [eq(worktreePlans.userId, ctx.userId)];
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
}

export async function planById(
  ctx: HandlerContext,
  input: { id: string },
) {
  const plan = await ctx.db.query.worktreePlans.findFirst({
    where: and(
      eq(worktreePlans.id, input.id),
      eq(worktreePlans.userId, ctx.userId),
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
}

export async function planByWorktree(
  ctx: HandlerContext,
  input: { worktreeId: string },
) {
  const wt = await ctx.db.query.worktrees.findFirst({
    where: and(
      eq(worktrees.id, input.worktreeId),
      eq(worktrees.userId, ctx.userId),
    ),
  });

  if (!wt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
  }

  const plan = await ctx.db.query.worktreePlans.findFirst({
    where: and(
      eq(worktreePlans.worktreeId, input.worktreeId),
      eq(worktreePlans.userId, ctx.userId),
    ),
    with: {
      tasks: {
        orderBy: planTaskItems.sortOrder,
      },
    },
  });

  return plan;
}

export async function planCreate(
  ctx: HandlerContext,
  input: {
    worktreeId: string;
    // `filePath` is provided by the tRPC `CreateWorktreePlanSchema` path; the
    // Effect-RPC `plan.create` contract does not carry it, so it is optional
    // here and falls back to an empty string for the NOT NULL column.
    filePath?: string;
    title?: string;
    goal?: string;
    status?: string;
    planningTaskId?: string | null;
  },
) {
  const wt = await ctx.db.query.worktrees.findFirst({
    where: and(
      eq(worktrees.id, input.worktreeId),
      eq(worktrees.userId, ctx.userId),
    ),
  });

  if (!wt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
  }

  const [plan] = await ctx.db
    .insert(worktreePlans)
    .values({
      worktreeId: input.worktreeId,
      filePath: input.filePath ?? "",
      title: input.title,
      goal: input.goal,
      status: input.status,
      planningTaskId: input.planningTaskId,
      userId: ctx.userId,
    })
    .returning();

  return plan;
}

export async function planUpdate(
  ctx: HandlerContext,
  input: {
    id: string;
    title?: string;
    goal?: string;
    status?: string;
    planningTaskId?: string | null;
  },
) {
  const { id, ...updates } = input;

  const existing = await ctx.db.query.worktreePlans.findFirst({
    where: and(
      eq(worktreePlans.id, id),
      eq(worktreePlans.userId, ctx.userId),
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
}

export async function planDelete(
  ctx: HandlerContext,
  input: { id: string },
) {
  await ctx.db
    .delete(worktreePlans)
    .where(
      and(
        eq(worktreePlans.id, input.id),
        eq(worktreePlans.userId, ctx.userId),
      ),
    );
  return { success: true };
}

export async function planSyncFromFile(
  ctx: HandlerContext,
  input: { id: string },
) {
  const plan = await ctx.db.query.worktreePlans.findFirst({
    where: and(
      eq(worktreePlans.id, input.id),
      eq(worktreePlans.userId, ctx.userId),
    ),
  });

  if (!plan) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
  }

  await ctx.db
    .update(worktreePlans)
    .set({ lastSyncedAt: new Date().toISOString() })
    .where(eq(worktreePlans.id, input.id));

  return { success: true };
}

export async function planAddTask(
  ctx: HandlerContext,
  input: {
    planId: string;
    content: string;
    status?: string;
    priority?: string;
    sortOrder?: number;
  },
) {
  const plan = await ctx.db.query.worktreePlans.findFirst({
    where: and(
      eq(worktreePlans.id, input.planId),
      eq(worktreePlans.userId, ctx.userId),
    ),
  });

  if (!plan) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
  }

  // `taskKey` is NOT NULL with no default; derive a stable per-plan key from
  // the current task count (the RPC payload does not carry one).
  const existingTasks = await ctx.db.query.planTaskItems.findMany({
    where: eq(planTaskItems.planId, input.planId),
  });
  const taskKey = `T${existingTasks.length + 1}`;

  const [task] = await ctx.db
    .insert(planTaskItems)
    .values({
      planId: input.planId,
      taskKey,
      content: input.content,
      status: input.status,
      priority: input.priority,
      sortOrder: input.sortOrder,
    })
    .returning();

  return task;
}

export async function planUpdateTask(
  ctx: HandlerContext,
  input: {
    id: string;
    content?: string;
    status?: string;
    priority?: string;
    sortOrder?: number;
  },
) {
  const { id, ...updates } = input;

  const task = await ctx.db.query.planTaskItems.findFirst({
    where: eq(planTaskItems.id, id),
    with: { plan: true },
  });

  if (task?.plan.userId !== ctx.userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }

  const updateData: Record<string, unknown> = { ...updates };
  if (updates.status === "completed") {
    updateData.completedAt = new Date().toISOString();
  }

  const [updated] = await ctx.db
    .update(planTaskItems)
    .set(updateData)
    .where(eq(planTaskItems.id, id))
    .returning();

  return updated;
}

export async function planDeleteTask(
  ctx: HandlerContext,
  input: { id: string },
) {
  const task = await ctx.db.query.planTaskItems.findFirst({
    where: eq(planTaskItems.id, input.id),
    with: { plan: true },
  });

  if (task?.plan.userId !== ctx.userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }

  await ctx.db.delete(planTaskItems).where(eq(planTaskItems.id, input.id));
  return { success: true };
}

export async function planReorderTasks(
  ctx: HandlerContext,
  input: { planId: string; taskIds: string[] },
) {
  const plan = await ctx.db.query.worktreePlans.findFirst({
    where: and(
      eq(worktreePlans.id, input.planId),
      eq(worktreePlans.userId, ctx.userId),
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
        .where(eq(planTaskItems.id, taskId)),
    ),
  );

  return { success: true };
}
