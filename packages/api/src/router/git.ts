import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, eq } from "@bob/db";
import { chatConversations, repositories, sessionEvents } from "@bob/db/schema";

import { createDraftPr } from "../services/git/prService";
import { protectedProcedure } from "../trpc";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3002";

async function gatewayRequest(
  userId: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${GATEWAY_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, ...body }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Gateway error: ${error}`,
    });
  }

  return response.json();
}

export const gitRouter = {
  status: protectedProcedure
    .input(z.object({ path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = (await gatewayRequest(ctx.session.user.id, "/git/status", {
        path: input.path,
      })) as {
        branch: string;
        ahead: number;
        behind: number;
        staged: string[];
        unstaged: string[];
        untracked: string[];
      };

      return result;
    }),

  diff: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        staged: z.boolean().default(false),
        file: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = (await gatewayRequest(ctx.session.user.id, "/git/diff", {
        path: input.path,
        staged: input.staged,
        file: input.file,
      })) as { diff: string };

      return result.diff;
    }),

  log: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        limit: z.number().min(1).max(100).default(20),
        branch: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = (await gatewayRequest(ctx.session.user.id, "/git/log", {
        path: input.path,
        limit: input.limit,
        branch: input.branch,
      })) as {
        commits: Array<{
          hash: string;
          shortHash: string;
          message: string;
          author: string;
          date: string;
        }>;
      };

      return result.commits;
    }),

  branches: protectedProcedure
    .input(z.object({ path: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = (await gatewayRequest(
        ctx.session.user.id,
        "/git/branches",
        {
          path: input.path,
        },
      )) as {
        current: string;
        local: string[];
        remote: string[];
      };

      return result;
    }),

  add: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        files: z.array(z.string()).default([]),
        all: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await gatewayRequest(ctx.session.user.id, "/git/add", {
        path: input.path,
        files: input.files,
        all: input.all,
      });

      return { success: true };
    }),

  commit: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        message: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = (await gatewayRequest(ctx.session.user.id, "/git/commit", {
        path: input.path,
        message: input.message,
      })) as { hash: string };

      return result;
    }),

  push: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        remote: z.string().default("origin"),
        branch: z.string().optional(),
        setUpstream: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await gatewayRequest(ctx.session.user.id, "/git/push", {
        path: input.path,
        remote: input.remote,
        branch: input.branch,
        setUpstream: input.setUpstream,
      });

      return { success: true };
    }),

  pull: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        remote: z.string().default("origin"),
        branch: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await gatewayRequest(ctx.session.user.id, "/git/pull", {
        path: input.path,
        remote: input.remote,
        branch: input.branch,
      });

      return { success: true };
    }),

  checkout: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        branch: z.string(),
        create: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await gatewayRequest(ctx.session.user.id, "/git/checkout", {
        path: input.path,
        branch: input.branch,
        create: input.create,
      });

      return { success: true };
    }),

  reset: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        files: z.array(z.string()).default([]),
        hard: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await gatewayRequest(ctx.session.user.id, "/git/reset", {
        path: input.path,
        files: input.files,
        hard: input.hard,
      });

      return { success: true };
    }),

  stash: protectedProcedure
    .input(
      z.object({
        path: z.string(),
        action: z.enum(["push", "pop", "list", "drop"]).default("push"),
        message: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = (await gatewayRequest(ctx.session.user.id, "/git/stash", {
        path: input.path,
        action: input.action,
        message: input.message,
      })) as { stashes?: string[] };

      return result;
    }),

  clone: protectedProcedure
    .input(
      z.object({
        url: z.string(),
        destination: z.string(),
        branch: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await gatewayRequest(ctx.session.user.id, "/git/clone", {
        url: input.url,
        destination: input.destination,
        branch: input.branch,
      });

      return { success: true };
    }),

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
        kanbangerTaskId: z.string().optional(),
        remote: z.string().default("origin"),
        setUpstream: z.boolean().default(true),
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

      await gatewayRequest(ctx.session.user.id, "/git/push", {
        path: input.path,
        remote: input.remote,
        branch: input.headBranch,
        setUpstream: input.setUpstream,
      });

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
} satisfies TRPCRouterRecord;
