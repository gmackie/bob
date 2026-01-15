import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import {
  createDraftPr,
  getPrById,
  linkPrToKanbangerTask,
  listPrsByRepository,
  listPrsBySession,
  mergePr,
  refreshPrFromRemote,
  syncCommits,
  updatePr,
} from "../services/git/prService";
import { protectedProcedure } from "../trpc";

const prStatusSchema = z.enum(["draft", "open", "merged", "closed"]);
const mergeMethodSchema = z.enum(["merge", "squash", "rebase"]);

export const pullRequestRouter = {
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
        kanbangerTaskId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createDraftPr({
          userId: ctx.session.user.id,
          repositoryId: input.repositoryId,
          sessionId: input.sessionId,
          title: input.title,
          body: input.body,
          headBranch: input.headBranch,
          baseBranch: input.baseBranch,
          draft: input.draft,
          kanbangerTaskId: input.kanbangerTaskId,
        });
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

  linkToKanbangerTask: protectedProcedure
    .input(
      z.object({
        pullRequestId: z.string().uuid(),
        kanbangerTaskId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await linkPrToKanbangerTask(
        ctx.session.user.id,
        input.pullRequestId,
        input.kanbangerTaskId,
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
} satisfies TRPCRouterRecord;
