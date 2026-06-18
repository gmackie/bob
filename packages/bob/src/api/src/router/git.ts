import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  gitPushAndCreatePr,
  gitJjIsRepo,
  gitJjLog,
  gitJjNew,
  gitJjDescribe,
  gitJjSquash,
  gitJjDiff,
} from "../handlers/git";

export const gitRouter = {
  // Git operations (status, diff, log, branches, add, commit, push, pull,
  // checkout, reset, stash, clone) previously proxied to the old monolithic
  // gateway which has been removed. These operations now run on the Go daemon.
  // The daemon streams results via the WS connection. If tRPC access is needed
  // in the future, add an HTTP API to the Go daemon.

  pushAndCreatePr: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid(),
        path: z.string(),
        sessionId: z.string().uuid().optional(),
        title: z.string().min(1).max(256),
        body: z.string().optional(),
        headBranch: z.string().min(1),
        baseBranch: z.string().optional(),
        draft: z.boolean().default(true),
        planningTaskId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      gitPushAndCreatePr({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  // ── JJ (Jujutsu) procedures ───────────────────────────────────────
  // These run JjClient directly (no gateway proxy), so they still work.

  jjIsRepo: protectedProcedure
    .input(z.object({ path: z.string() }))
    .query(({ ctx, input }) =>
      gitJjIsRepo({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  jjLog: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(({ ctx, input }) =>
      gitJjLog({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  jjNew: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        description: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      gitJjNew({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  jjDescribe: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        description: z.string(),
        revision: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      gitJjDescribe({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  jjSquash: protectedProcedure
    .input(z.object({ path: z.string() }))
    .mutation(({ ctx, input }) =>
      gitJjSquash({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  jjDiff: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        revision: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      gitJjDiff({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
