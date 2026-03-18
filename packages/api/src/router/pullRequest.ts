import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { prReviews, user } from "@bob/db/schema";
import { z } from "zod/v4";

import {
  createDraftPr,
  getPrById,
  linkPrToPlanningTask,
  listAllPrs,
  listPrsByRepository,
  listPrsBySession,
  mergePr,
  refreshPrFromRemote,
  syncCommits,
  updatePr,
} from "../services/git/prService";
import { onPullRequestCreated } from "../services/automation/pipeline-trigger";
import { protectedProcedure } from "../trpc";

const prStatusSchema = z.enum(["draft", "open", "merged", "closed"]);
const mergeMethodSchema = z.enum(["merge", "squash", "rebase"]);

export const pullRequestRouter = {
  list: protectedProcedure
    .input(
      z.object({
        status: prStatusSchema.optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return listAllPrs(ctx.session.user.id, {
        status: input.status,
        limit: input.limit,
      });
    }),

  get: protectedProcedure
    .input(z.object({ pullRequestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const pr = await getPrById(ctx.session.user.id, input.pullRequestId);
      if (!pr) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pull request not found",
        });
      }
      return pr;
    }),

  listByRepository: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid(),
        status: prStatusSchema.optional(),
        limit: z.number().int().min(1).max(100).optional(),
        includeCommits: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return listPrsByRepository(ctx.session.user.id, input.repositoryId, {
        status: input.status,
        limit: input.limit,
        includeCommits: input.includeCommits,
      });
    }),

  listBySession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return listPrsBySession(ctx.session.user.id, input.sessionId);
    }),

  create: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
        title: z.string().min(1).max(256),
        body: z.string().optional(),
        headBranch: z.string().min(1),
        baseBranch: z.string().optional(),
        draft: z.boolean().optional(),
        planningTaskId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const pr = await createDraftPr({
          userId: ctx.session.user.id,
          repositoryId: input.repositoryId,
          sessionId: input.sessionId,
          title: input.title,
          body: input.body,
          headBranch: input.headBranch,
          baseBranch: input.baseBranch,
          draft: input.draft,
          planningTaskId: input.planningTaskId,
        });

        // Fire-and-forget: create a forge revision for CI tracking
        if (pr.repositoryId) {
          onPullRequestCreated({
            pullRequestId: pr.id,
            repositoryId: pr.repositoryId,
            headBranch: pr.headBranch,
            headSha: pr.headBranch, // placeholder — real SHA comes from commit sync
            taskId: input.planningTaskId ?? undefined,
          }).catch(() => {
            // Intentionally swallowed — pipeline trigger is best-effort
          });
        }

        return pr;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create pull request",
        });
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        pullRequestId: z.string().uuid(),
        title: z.string().min(1).max(256).optional(),
        body: z.string().optional(),
        state: z.enum(["open", "closed"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updatePr({
          userId: ctx.session.user.id,
          pullRequestId: input.pullRequestId,
          title: input.title,
          body: input.body,
          state: input.state,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Pull request not found"
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pull request not found",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to update pull request",
        });
      }
    }),

  merge: protectedProcedure
    .input(
      z.object({
        pullRequestId: z.string().uuid(),
        mergeMethod: mergeMethodSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await mergePr({
          userId: ctx.session.user.id,
          pullRequestId: input.pullRequestId,
          mergeMethod: input.mergeMethod,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Pull request not found"
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pull request not found",
          });
        }
        if (
          error instanceof Error &&
          error.message.includes("already merged")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Pull request is already merged",
          });
        }
        if (
          error instanceof Error &&
          error.message.includes("closed pull request")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot merge a closed pull request",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to merge pull request",
        });
      }
    }),

  syncCommits: protectedProcedure
    .input(z.object({ pullRequestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await syncCommits({
          userId: ctx.session.user.id,
          pullRequestId: input.pullRequestId,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Pull request not found"
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pull request not found",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Failed to sync commits",
        });
      }
    }),

  linkToPlanningTask: protectedProcedure
    .input(
      z.object({
        pullRequestId: z.string().uuid(),
        planningTaskId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await linkPrToPlanningTask(
        ctx.session.user.id,
        input.pullRequestId,
        input.planningTaskId,
      );
      return { success: true };
    }),

  refresh: protectedProcedure
    .input(z.object({ pullRequestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await refreshPrFromRemote(
          ctx.session.user.id,
          input.pullRequestId,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Pull request not found"
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pull request not found",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to refresh pull request",
        });
      }
    }),
  listReviews: protectedProcedure
    .input(z.object({ pullRequestId: z.string().uuid() }))
    .query(async ({ input }) => {
      const reviews = await db
        .select({
          id: prReviews.id,
          pullRequestId: prReviews.pullRequestId,
          userId: prReviews.userId,
          status: prReviews.status,
          body: prReviews.body,
          createdAt: prReviews.createdAt,
          userName: user.name,
          userImage: user.image,
        })
        .from(prReviews)
        .leftJoin(user, eq(prReviews.userId, user.id))
        .where(eq(prReviews.pullRequestId, input.pullRequestId))
        .orderBy(desc(prReviews.createdAt));

      return reviews;
    }),

  addReview: protectedProcedure
    .input(
      z.object({
        pullRequestId: z.string().uuid(),
        status: z.enum(["approved", "changes_requested", "commented"]),
        body: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [review] = await db
        .insert(prReviews)
        .values({
          pullRequestId: input.pullRequestId,
          userId: ctx.session.user.id,
          status: input.status,
          body: input.body ?? null,
        })
        .returning();
      return review;
    }),
} satisfies TRPCRouterRecord;
