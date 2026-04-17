import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq } from "@bob/db";
import { chatConversations, repositories, sessionEvents } from "@bob/db/schema";

import { JjClient } from "@bob/execution-lib/vcs/jj-client";

import { createDraftPr } from "../services/git/prService";
import { protectedProcedure } from "../trpc";

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
    .mutation(async ({ ctx, input }) => {
      const repo = await ctx.db.query.repositories.findFirst({
        where: and(
          eq(repositories.id, input.repositoryId),
          eq(repositories.userId, ctx.session.user.id),
        ),
      });

      if (!repo) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Repository not found",
        });
      }

      // The branch is expected to be already pushed by the agent or daemon.
      // Previously this endpoint pushed via the old gateway, but the daemon
      // now owns git operations.

      let pr;
      try {
        pr = await createDraftPr({
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
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create pull request",
        });
      }

      if (input.sessionId) {
        const session = await ctx.db.query.chatConversations.findFirst({
          where: eq(chatConversations.id, input.sessionId),
        });

        if (session) {
          const seq = session.nextSeq;
          await ctx.db
            .update(chatConversations)
            .set({ nextSeq: seq + 1 })
            .where(eq(chatConversations.id, input.sessionId));

          await ctx.db.insert(sessionEvents).values({
            sessionId: input.sessionId,
            seq,
            direction: "system",
            eventType: "state",
            payload: {
              type: "pr_created",
              pullRequestId: pr.id,
              number: pr.number,
              title: pr.title,
              url: pr.url,
              status: pr.status,
            },
          });
        }
      }

      return {
        pushed: true,
        pullRequest: pr,
      };
    }),

  // ── JJ (Jujutsu) procedures ───────────────────────────────────────
  // These run JjClient directly (no gateway proxy), so they still work.

  jjIsRepo: protectedProcedure
    .input(z.object({ path: z.string() }))
    .query(({ input }) => {
      const jj = new JjClient(input.path);
      return jj.isJjRepo();
    }),

  jjLog: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(({ input }) => {
      const jj = new JjClient(input.path);
      return jj.log(input.limit);
    }),

  jjNew: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        description: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const jj = new JjClient(input.path);
      return jj.new(input.description);
    }),

  jjDescribe: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        description: z.string(),
        revision: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const jj = new JjClient(input.path);
      return jj.describe(input.description, input.revision);
    }),

  jjSquash: protectedProcedure
    .input(z.object({ path: z.string() }))
    .mutation(({ input }) => {
      const jj = new JjClient(input.path);
      return jj.squash();
    }),

  jjDiff: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        revision: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      const jj = new JjClient(input.path);
      return jj.diff(input.revision);
    }),
} satisfies TRPCRouterRecord;
