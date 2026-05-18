/**
 * AgentRun handler functions — pure business logic extracted from the tRPC
 * agentRun router.
 *
 * Phase 7B-4D-beta Task 2.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "@bob/db";
import { agentRuns, workItems, workspaceMembers } from "@bob/db/schema";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function assertWorkspaceAccess(
  db: any,
  userId: string,
  workspaceId: string,
) {
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

async function loadAccessibleWorkItem(
  db: any,
  userId: string,
  workItemId: string,
) {
  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
    columns: { id: true, workspaceId: true },
  });

  if (!workItem?.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await assertWorkspaceAccess(db, userId, workItem.workspaceId);
  return workItem;
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function agentRunGet(
  ctx: HandlerContext,
  input: { runId: string },
) {
  const run = await ctx.db.query.agentRuns.findFirst({
    where: eq(agentRuns.id, input.runId),
    with: { artifacts: true, session: { columns: { id: true, title: true, status: true } } },
  });

  if (!run?.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await assertWorkspaceAccess(ctx.db, ctx.userId, run.workspaceId);
  return run;
}

export async function agentRunList(
  ctx: HandlerContext,
  input: { workspaceId: string; limit: number },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  return ctx.db.query.agentRuns.findMany({
    where: eq(agentRuns.workspaceId, input.workspaceId),
    with: { artifacts: true, session: { columns: { title: true } } },
    orderBy: [desc(agentRuns.createdAt)],
    limit: input.limit,
  });
}

export async function agentRunListAll(
  ctx: HandlerContext,
  input: { limit: number },
) {
  const memberships = await ctx.db.query.workspaceMembers.findMany({
    where: eq(workspaceMembers.userId, ctx.userId),
    columns: { workspaceId: true },
  });

  const wsIds = memberships.map((m) => m.workspaceId);
  if (wsIds.length === 0) return [];

  return ctx.db.query.agentRuns.findMany({
    where: inArray(agentRuns.workspaceId, wsIds),
    with: {
      artifacts: true,
      session: { columns: { title: true } },
      workspace: { columns: { id: true, name: true } },
    },
    orderBy: [desc(agentRuns.createdAt)],
    limit: input.limit,
  });
}

export async function agentRunListByWorkItem(
  ctx: HandlerContext,
  input: { workItemId: string; limit: number },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  return ctx.db.query.agentRuns.findMany({
    where: eq(agentRuns.workItemId, input.workItemId),
    with: { artifacts: true },
    orderBy: [desc(agentRuns.createdAt)],
    limit: input.limit,
  });
}
