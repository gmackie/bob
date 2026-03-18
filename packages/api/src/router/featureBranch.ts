import type { TRPCRouterRecord } from "@trpc/server";
import { and, count, eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  featureBranches,
  featureBranchTaskPRs,
  pullRequests,
} from "@bob/db/schema";
import { z } from "zod/v4";

import { createDraftPr } from "../services/git/prService";
import { protectedProcedure } from "../trpc";

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
    .mutation(async ({ input }) => {
      const [branch] = await db
        .insert(featureBranches)
        .values({
          workItemId: input.workItemId,
          repositoryId: input.repositoryId,
          branchName: input.branchName,
          baseBranch: input.baseBranch ?? "main",
        })
        .returning();
      return branch;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [branch] = await db
        .select()
        .from(featureBranches)
        .where(eq(featureBranches.id, input.id));

      if (!branch) return null;

      const taskPRs = await db
        .select({
          id: featureBranchTaskPRs.id,
          featureBranchId: featureBranchTaskPRs.featureBranchId,
          pullRequestId: featureBranchTaskPRs.pullRequestId,
          mergedAt: featureBranchTaskPRs.mergedAt,
          createdAt: featureBranchTaskPRs.createdAt,
          pullRequest: pullRequests,
        })
        .from(featureBranchTaskPRs)
        .leftJoin(
          pullRequests,
          eq(featureBranchTaskPRs.pullRequestId, pullRequests.id),
        )
        .where(eq(featureBranchTaskPRs.featureBranchId, input.id));

      return { ...branch, taskPRs };
    }),

  list: protectedProcedure
    .input(z.object({ workItemId: z.string().uuid() }))
    .query(async ({ input }) => {
      const branches = await db
        .select({
          id: featureBranches.id,
          workItemId: featureBranches.workItemId,
          repositoryId: featureBranches.repositoryId,
          branchName: featureBranches.branchName,
          baseBranch: featureBranches.baseBranch,
          status: featureBranches.status,
          featurePrId: featureBranches.featurePrId,
          createdAt: featureBranches.createdAt,
          taskPRCount: count(featureBranchTaskPRs.id),
        })
        .from(featureBranches)
        .leftJoin(
          featureBranchTaskPRs,
          eq(featureBranches.id, featureBranchTaskPRs.featureBranchId),
        )
        .where(eq(featureBranches.workItemId, input.workItemId))
        .groupBy(featureBranches.id);

      return branches;
    }),

  addTaskPR: protectedProcedure
    .input(
      z.object({
        featureBranchId: z.string().uuid(),
        pullRequestId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input }) => {
      const [record] = await db
        .insert(featureBranchTaskPRs)
        .values({
          featureBranchId: input.featureBranchId,
          pullRequestId: input.pullRequestId,
        })
        .returning();
      return record;
    }),

  markTaskPRMerged: protectedProcedure
    .input(
      z.object({
        featureBranchId: z.string().uuid(),
        pullRequestId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(featureBranchTaskPRs)
        .set({ mergedAt: new Date() })
        .where(
          and(
            eq(featureBranchTaskPRs.featureBranchId, input.featureBranchId),
            eq(featureBranchTaskPRs.pullRequestId, input.pullRequestId),
          ),
        )
        .returning();
      return updated;
    }),

  createFeaturePR: protectedProcedure
    .input(
      z.object({
        featureBranchId: z.string().uuid(),
        title: z.string().min(1),
        repositoryId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Get the feature branch to find branchName and baseBranch
      const [branch] = await db
        .select()
        .from(featureBranches)
        .where(eq(featureBranches.id, input.featureBranchId));

      if (!branch) {
        throw new Error("Feature branch not found");
      }

      // Create the PR via the existing service
      const pr = await createDraftPr({
        userId: ctx.session.user.id,
        repositoryId: input.repositoryId,
        title: input.title,
        headBranch: branch.branchName,
        baseBranch: branch.baseBranch,
        draft: false,
      });

      // Link the PR back to the feature branch
      const [updated] = await db
        .update(featureBranches)
        .set({ featurePrId: pr.id })
        .where(eq(featureBranches.id, input.featureBranchId))
        .returning();

      return { featureBranch: updated, pullRequest: pr };
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: statusSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const [updated] = await db
        .update(featureBranches)
        .set({ status: input.status })
        .where(eq(featureBranches.id, input.id))
        .returning();
      return updated;
    }),
} satisfies TRPCRouterRecord;
