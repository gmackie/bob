import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { agentTypeEnum, instanceStatusEnum } from "@bob/db/schema";

import { protectedProcedure } from "../trpc";
import {
  instanceList,
  instanceById,
  instanceByRepository,
  instanceByWorktree,
  instanceStart,
  instanceStop,
  instanceRestart,
  instanceDelete,
  instanceUpdateStatus,
} from "../handlers/instance";

export const instanceRouter = {
  list: protectedProcedure.query(({ ctx }) =>
    instanceList({ db: ctx.db, userId: ctx.session.user.id }),
  ),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      instanceById({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  byRepository: protectedProcedure
    .input(z.object({ repositoryId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      instanceByRepository(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  byWorktree: protectedProcedure
    .input(z.object({ worktreeId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      instanceByWorktree(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  start: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        agentType: z.enum(agentTypeEnum).optional().default("claude"),
      }),
    )
    .mutation(({ ctx, input }) =>
      instanceStart({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  stop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      instanceStop({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  restart: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      instanceRestart({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      instanceDelete({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(instanceStatusEnum),
        pid: z.number().optional(),
        errorMessage: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      instanceUpdateStatus(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),
} satisfies TRPCRouterRecord;
