/**
 * Instance handler functions — pure business logic extracted from the tRPC
 * instance router.
 *
 * Phase 7B-4D-beta Task 6.
 */
import { TRPCError } from "@trpc/server";
import { desc, eq, and } from "@bob/db";
import {
  agentInstances,
  worktrees,
  agentTypeEnum,
  instanceStatusEnum,
} from "@bob/db/schema";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function instanceList(ctx: HandlerContext) {
  const instances = await ctx.db.query.agentInstances.findMany({
    where: eq(agentInstances.userId, ctx.userId),
    orderBy: desc(agentInstances.createdAt),
  });
  return instances;
}

export async function instanceById(
  ctx: HandlerContext,
  input: { id: string },
) {
  const instance = await ctx.db.query.agentInstances.findFirst({
    where: and(
      eq(agentInstances.id, input.id),
      eq(agentInstances.userId, ctx.userId),
    ),
  });

  if (!instance) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
  }

  return instance;
}

export async function instanceByRepository(
  ctx: HandlerContext,
  input: { repositoryId: string },
) {
  const instances = await ctx.db.query.agentInstances.findMany({
    where: and(
      eq(agentInstances.repositoryId, input.repositoryId),
      eq(agentInstances.userId, ctx.userId),
    ),
    orderBy: desc(agentInstances.createdAt),
  });
  return instances;
}

export async function instanceByWorktree(
  ctx: HandlerContext,
  input: { worktreeId: string },
) {
  const instances = await ctx.db.query.agentInstances.findMany({
    where: and(
      eq(agentInstances.worktreeId, input.worktreeId),
      eq(agentInstances.userId, ctx.userId),
    ),
    orderBy: desc(agentInstances.createdAt),
  });
  return instances;
}

export async function instanceStart(
  ctx: HandlerContext,
  input: { worktreeId: string; agentType: (typeof agentTypeEnum)[number] },
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

  const [instance] = await ctx.db
    .insert(agentInstances)
    .values({
      userId: ctx.userId,
      repositoryId: wt.repositoryId,
      worktreeId: input.worktreeId,
      agentType: input.agentType,
      status: "starting",
    })
    .returning();

  return instance;
}

export async function instanceStop(
  ctx: HandlerContext,
  input: { id: string },
) {
  const instance = await ctx.db.query.agentInstances.findFirst({
    where: and(
      eq(agentInstances.id, input.id),
      eq(agentInstances.userId, ctx.userId),
    ),
  });

  if (!instance) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
  }

  const [updated] = await ctx.db
    .update(agentInstances)
    .set({ status: "stopped", pid: null })
    .where(eq(agentInstances.id, input.id))
    .returning();

  return updated;
}

export async function instanceRestart(
  ctx: HandlerContext,
  input: { id: string },
) {
  const instance = await ctx.db.query.agentInstances.findFirst({
    where: and(
      eq(agentInstances.id, input.id),
      eq(agentInstances.userId, ctx.userId),
    ),
  });

  if (!instance) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
  }

  const [updated] = await ctx.db
    .update(agentInstances)
    .set({ status: "starting", pid: null })
    .where(eq(agentInstances.id, input.id))
    .returning();

  return updated;
}

export async function instanceDelete(
  ctx: HandlerContext,
  input: { id: string },
) {
  await ctx.db
    .delete(agentInstances)
    .where(
      and(
        eq(agentInstances.id, input.id),
        eq(agentInstances.userId, ctx.userId),
      ),
    );
  return { success: true };
}

export async function instanceUpdateStatus(
  ctx: HandlerContext,
  input: {
    id: string;
    status: (typeof instanceStatusEnum)[number];
    pid?: number;
    errorMessage?: string;
  },
) {
  const [updated] = await ctx.db
    .update(agentInstances)
    .set({
      status: input.status,
      pid: input.pid ?? null,
      errorMessage: input.errorMessage ?? null,
      lastActivity: new Date().toISOString(),
    })
    .where(
      and(
        eq(agentInstances.id, input.id),
        eq(agentInstances.userId, ctx.userId),
      ),
    )
    .returning();

  if (!updated) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
  }

  return updated;
}
