import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq, and, gte, lte } from "@bob/db";
import { eventLog, eventTypeEnum } from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

export const eventRouter = {
  list: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid().optional(),
        repositoryId: z.string().uuid().optional(),
        eventType: z.enum(eventTypeEnum).optional(),
        limit: z.number().min(1).max(500).default(100),
        offset: z.number().min(0).default(0),
        since: z.date().optional(),
        until: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(eventLog.userId, ctx.session.user.id)];

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
        conditions.push(gte(eventLog.createdAt, input.since));
      }
      if (input.until) {
        conditions.push(lte(eventLog.createdAt, input.until));
      }

      const events = await ctx.db.query.eventLog.findMany({
        where: and(...conditions),
        orderBy: desc(eventLog.createdAt),
        limit: input.limit,
        offset: input.offset,
      });

      return events;
    }),

  create: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid().optional(),
        repositoryId: z.string().uuid().optional(),
        eventType: z.enum(eventTypeEnum),
        payload: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [event] = await ctx.db
        .insert(eventLog)
        .values({
          userId: ctx.session.user.id,
          worktreeId: input.worktreeId,
          repositoryId: input.repositoryId,
          eventType: input.eventType,
          payload: input.payload,
        })
        .returning();

      return event;
    }),

  recentActivity: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const events = await ctx.db.query.eventLog.findMany({
        where: eq(eventLog.userId, ctx.session.user.id),
        orderBy: desc(eventLog.createdAt),
        limit: input.limit,
        with: {
          worktree: true,
          repository: true,
        },
      });

      return events;
    }),

  byWorktree: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        limit: z.number().min(1).max(500).default(100),
        since: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(eventLog.userId, ctx.session.user.id),
        eq(eventLog.worktreeId, input.worktreeId),
      ];

      if (input.since) {
        conditions.push(gte(eventLog.createdAt, input.since));
      }

      const events = await ctx.db.query.eventLog.findMany({
        where: and(...conditions),
        orderBy: desc(eventLog.createdAt),
        limit: input.limit,
      });

      return events;
    }),

  stats: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid().optional(),
        repositoryId: z.string().uuid().optional(),
        since: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(eventLog.userId, ctx.session.user.id)];

      if (input.worktreeId) {
        conditions.push(eq(eventLog.worktreeId, input.worktreeId));
      }
      if (input.repositoryId) {
        conditions.push(eq(eventLog.repositoryId, input.repositoryId));
      }
      if (input.since) {
        conditions.push(gte(eventLog.createdAt, input.since));
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
    }),
} satisfies TRPCRouterRecord;
