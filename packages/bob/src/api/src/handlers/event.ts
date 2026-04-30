/**
 * Event handler functions — pure business logic extracted from the tRPC
 * event router.
 *
 * Phase 7B-4D-beta Task 3.
 */
import { and, desc, eq, gte, lte } from "@bob/db";
import { eventLog } from "@bob/db/schema";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function eventList(
  ctx: HandlerContext,
  input: {
    worktreeId?: string;
    repositoryId?: string;
    eventType?: string;
    limit: number;
    offset: number;
    since?: Date;
    until?: Date;
  },
) {
  const conditions = [eq(eventLog.userId, ctx.userId)];

  if (input.worktreeId) {
    conditions.push(eq(eventLog.worktreeId, input.worktreeId));
  }
  if (input.repositoryId) {
    conditions.push(eq(eventLog.repositoryId, input.repositoryId));
  }
  if (input.eventType) {
    conditions.push(eq(eventLog.eventType, input.eventType));
  }
  if (input.since) {
    conditions.push(gte(eventLog.createdAt, input.since.toISOString()));
  }
  if (input.until) {
    conditions.push(lte(eventLog.createdAt, input.until.toISOString()));
  }

  const events = await ctx.db.query.eventLog.findMany({
    where: and(...conditions),
    orderBy: desc(eventLog.createdAt),
    limit: input.limit,
    offset: input.offset,
  });

  return events;
}

export async function eventCreate(
  ctx: HandlerContext,
  input: {
    worktreeId?: string;
    repositoryId?: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
) {
  const [event] = await ctx.db
    .insert(eventLog)
    .values({
      userId: ctx.userId,
      worktreeId: input.worktreeId,
      repositoryId: input.repositoryId,
      eventType: input.eventType,
      payload: input.payload,
    })
    .returning();

  return event;
}

export async function eventRecentActivity(
  ctx: HandlerContext,
  input: { limit: number },
) {
  const events = await ctx.db.query.eventLog.findMany({
    where: eq(eventLog.userId, ctx.userId),
    orderBy: desc(eventLog.createdAt),
    limit: input.limit,
    with: {
      worktree: true,
      repository: true,
    },
  });

  return events;
}

export async function eventByWorktree(
  ctx: HandlerContext,
  input: {
    worktreeId: string;
    limit: number;
    since?: Date;
  },
) {
  const conditions = [
    eq(eventLog.userId, ctx.userId),
    eq(eventLog.worktreeId, input.worktreeId),
  ];

  if (input.since) {
    conditions.push(gte(eventLog.createdAt, input.since.toISOString()));
  }

  const events = await ctx.db.query.eventLog.findMany({
    where: and(...conditions),
    orderBy: desc(eventLog.createdAt),
    limit: input.limit,
  });

  return events;
}

export async function eventStats(
  ctx: HandlerContext,
  input: {
    worktreeId?: string;
    repositoryId?: string;
    since?: Date;
  },
) {
  const conditions = [eq(eventLog.userId, ctx.userId)];

  if (input.worktreeId) {
    conditions.push(eq(eventLog.worktreeId, input.worktreeId));
  }
  if (input.repositoryId) {
    conditions.push(eq(eventLog.repositoryId, input.repositoryId));
  }
  if (input.since) {
    conditions.push(gte(eventLog.createdAt, input.since.toISOString()));
  }

  const events = await ctx.db.query.eventLog.findMany({
    where: and(...conditions),
  });

  const byType = new Map<string, number>();
  for (const event of events) {
    const count = byType.get(event.eventType) ?? 0;
    byType.set(event.eventType, count + 1);
  }

  return {
    total: events.length,
    byType: Object.fromEntries(byType),
  };
}
