import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import {
  CreateWorktreeLinkSchema,
  linkTypeEnum,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";
import {
  linkList,
  linkById,
  linkByWorktree,
  linkCreate,
  linkUpdate,
  linkDelete,
  linkToPlanningTask,
  linkToGitHubPR,
} from "../handlers/link";

export const linkRouter = {
  list: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid().optional(),
        linkType: z.enum(linkTypeEnum).optional(),
      })
    )
    .query(({ ctx, input }) =>
      linkList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      linkById({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  byWorktree: protectedProcedure
    .input(z.object({ worktreeId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      linkByWorktree({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  create: protectedProcedure
    .input(CreateWorktreeLinkSchema)
    .mutation(({ ctx, input }) =>
      linkCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        externalId: z.string().max(256).optional(),
        url: z.string().url().optional(),
        title: z.string().max(256).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      linkUpdate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      linkDelete({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  linkToPlanningTask: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        taskId: z.string(),
        taskUrl: z.string().url().optional(),
        taskTitle: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      linkToPlanningTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  linkToGitHubPR: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        prNumber: z.number(),
        prUrl: z.string().url(),
        prTitle: z.string(),
        repoOwner: z.string(),
        repoName: z.string(),
      })
    )
    .mutation(({ ctx, input }) =>
      linkToGitHubPR({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
