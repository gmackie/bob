import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  pullRequestList,
  pullRequestGet,
  pullRequestListByRepository,
  pullRequestListBySession,
  pullRequestCreate,
  pullRequestUpdate,
  pullRequestMerge,
  pullRequestSyncCommits,
  pullRequestLinkToPlanningTask,
  pullRequestRefresh,
  pullRequestListReviews,
  pullRequestAddReview,
} from "../handlers/pullRequest";

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
    .query(({ ctx, input }) =>
      pullRequestList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  get: protectedProcedure
    .input(z.object({ pullRequestId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      pullRequestGet({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listByRepository: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid(),
        status: prStatusSchema.optional(),
        limit: z.number().int().min(1).max(100).optional(),
        includeCommits: z.boolean().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      pullRequestListByRepository({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listBySession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      pullRequestListBySession({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      pullRequestCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  update: protectedProcedure
    .input(
      z.object({
        pullRequestId: z.string().uuid(),
        title: z.string().min(1).max(256).optional(),
        body: z.string().optional(),
        state: z.enum(["open", "closed"]).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      pullRequestUpdate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  merge: protectedProcedure
    .input(
      z.object({
        pullRequestId: z.string().uuid(),
        mergeMethod: mergeMethodSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      pullRequestMerge({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  syncCommits: protectedProcedure
    .input(z.object({ pullRequestId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      pullRequestSyncCommits({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  linkToPlanningTask: protectedProcedure
    .input(
      z.object({
        pullRequestId: z.string().uuid(),
        planningTaskId: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      pullRequestLinkToPlanningTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  refresh: protectedProcedure
    .input(z.object({ pullRequestId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      pullRequestRefresh({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listReviews: protectedProcedure
    .input(z.object({ pullRequestId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      pullRequestListReviews({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  addReview: protectedProcedure
    .input(
      z.object({
        pullRequestId: z.string().uuid(),
        status: z.enum(["approved", "changes_requested", "commented"]),
        body: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      pullRequestAddReview({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
