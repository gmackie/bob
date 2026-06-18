import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { agentTypeEnum, planStatusEnum } from "@bob/db/schema";

import { protectedProcedure } from "../trpc";
import {
  repositoryList,
  repositoryById,
  repositoryAdd,
  repositoryAddFromProvider,
  repositoryDelete,
  repositoryRefreshMainBranch,
  repositoryGetWorktrees,
  repositoryCreateWorktree,
  repositoryGetWorktreePlanning,
  repositoryUpdateWorktreePlanning,
  repositoryDeleteWorktree,
  repositoryGetWorktreeMergeStatus,
} from "../handlers/repository";

export const repositoryRouter = {
  list: protectedProcedure.query(({ ctx }) =>
    repositoryList({ db: ctx.db, userId: ctx.session.user.id }),
  ),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      repositoryById({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  add: protectedProcedure
    .input(z.object({ repositoryPath: z.string() }))
    .mutation(({ ctx, input }) =>
      repositoryAdd({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  addFromProvider: protectedProcedure
    .input(
      z.object({
        fullName: z.string(),
        cloneUrl: z.string(),
        htmlUrl: z.string(),
        defaultBranch: z.string().default("main"),
        provider: z.string().optional(),
        instanceUrl: z.string().optional(),
        projectId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      repositoryAddFromProvider({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      repositoryDelete({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  refreshMainBranch: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      repositoryRefreshMainBranch({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getWorktrees: protectedProcedure
    .input(z.object({ repositoryId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      repositoryGetWorktrees({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  createWorktree: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid(),
        branchName: z.string(),
        baseBranch: z.string().optional(),
        agentType: z.enum(agentTypeEnum).optional().default("claude"),
        planning: z
          .object({
            title: z.string().optional(),
            goal: z.string().optional(),
            planningTaskId: z.string().optional(),
            tasks: z
              .array(
                z.object({
                  key: z.string(),
                  content: z.string(),
                  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
                })
              )
              .optional(),
          })
          .optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      repositoryCreateWorktree({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getWorktreePlanning: protectedProcedure
    .input(z.object({ worktreeId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      repositoryGetWorktreePlanning({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  updateWorktreePlanning: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        content: z.string().optional(),
        title: z.string().optional(),
        goal: z.string().optional(),
        status: z.enum(planStatusEnum).optional(),
        planningTaskId: z.string().optional().nullable(),
        tasks: z
          .array(
            z.object({
              key: z.string(),
              content: z.string(),
              status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      repositoryUpdateWorktreePlanning({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  deleteWorktree: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        force: z.boolean().optional().default(false),
      })
    )
    .mutation(({ ctx, input }) =>
      repositoryDeleteWorktree({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getWorktreeMergeStatus: protectedProcedure
    .input(z.object({ worktreeId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      repositoryGetWorktreeMergeStatus({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
