import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  featureBranchCreate,
  featureBranchGet,
  featureBranchList,
  featureBranchAddTaskPR,
  featureBranchMarkTaskPRMerged,
  featureBranchCreateFeaturePR,
  featureBranchUpdateStatus,
} from "../handlers/featureBranch";

const statusSchema = z.enum(["active", "ready", "merged", "abandoned"]);

export const featureBranchRouter = {
  create: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        repositoryId: z.string().uuid(),
        branchName: z.string().min(1),
        baseBranch: z.string().min(1).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      featureBranchCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      featureBranchGet({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  list: protectedProcedure
    .input(z.object({ workItemId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      featureBranchList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  addTaskPR: protectedProcedure
    .input(
      z.object({
        featureBranchId: z.string().uuid(),
        pullRequestId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      featureBranchAddTaskPR({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  markTaskPRMerged: protectedProcedure
    .input(
      z.object({
        featureBranchId: z.string().uuid(),
        pullRequestId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      featureBranchMarkTaskPRMerged({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  createFeaturePR: protectedProcedure
    .input(
      z.object({
        featureBranchId: z.string().uuid(),
        title: z.string().min(1),
        repositoryId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      featureBranchCreateFeaturePR({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: statusSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      featureBranchUpdateStatus({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
