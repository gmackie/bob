/**
 * Git handler functions — pure business logic extracted from the tRPC
 * git router.
 *
 * Phase 7B-4D-beta Task 4.
 */
import { TRPCError } from "@trpc/server";
import { and, eq } from "@bob/db";
import { chatConversations, repositories, sessionEvents } from "@bob/db/schema";

import { JjClient } from "@bob/execution-lib/vcs/jj-client";

import { createDraftPr } from "../services/git/prService";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function gitPushAndCreatePr(
  ctx: HandlerContext,
  input: {
    repositoryId: string;
    path: string;
    sessionId?: string;
    title: string;
    body?: string;
    headBranch: string;
    baseBranch?: string;
    draft: boolean;
    planningTaskId?: string;
  },
) {
  const repo = await ctx.db.query.repositories.findFirst({
    where: and(
      eq(repositories.id, input.repositoryId),
      eq(repositories.userId, ctx.userId),
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
      userId: ctx.userId,
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
}

// ── JJ (Jujutsu) handlers ────────────────────────────────────────────

export async function gitJjIsRepo(
  _ctx: HandlerContext,
  input: { path: string },
) {
  const jj = new JjClient(input.path);
  return jj.isJjRepo();
}

export async function gitJjLog(
  _ctx: HandlerContext,
  input: { path: string; limit: number },
) {
  const jj = new JjClient(input.path);
  return jj.log(input.limit);
}

export async function gitJjNew(
  _ctx: HandlerContext,
  input: { path: string; description?: string },
) {
  const jj = new JjClient(input.path);
  return jj.new(input.description);
}

export async function gitJjDescribe(
  _ctx: HandlerContext,
  input: { path: string; description: string; revision?: string },
) {
  const jj = new JjClient(input.path);
  return jj.describe(input.description, input.revision);
}

export async function gitJjSquash(
  _ctx: HandlerContext,
  input: { path: string },
) {
  const jj = new JjClient(input.path);
  return jj.squash();
}

export async function gitJjDiff(
  _ctx: HandlerContext,
  input: { path: string; revision?: string },
) {
  const jj = new JjClient(input.path);
  return jj.diff(input.revision);
}
