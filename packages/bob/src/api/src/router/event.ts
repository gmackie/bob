import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { eventTypeEnum } from "@bob/db/schema";

import { protectedProcedure } from "../trpc";
import {
  eventList,
  eventCreate,
  eventRecentActivity,
  eventByWorktree,
  eventStats,
} from "../handlers/event";

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
    .query(({ ctx, input }) =>
      eventList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  create: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid().optional(),
        repositoryId: z.string().uuid().optional(),
        eventType: z.enum(eventTypeEnum),
        payload: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .mutation(({ ctx, input }) =>
      eventCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  recentActivity: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(({ ctx, input }) =>
      eventRecentActivity({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  byWorktree: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        limit: z.number().min(1).max(500).default(100),
        since: z.date().optional(),
      })
    )
    .query(({ ctx, input }) =>
      eventByWorktree({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  stats: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid().optional(),
        repositoryId: z.string().uuid().optional(),
        since: z.date().optional(),
      })
    )
    .query(({ ctx, input }) =>
      eventStats({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
