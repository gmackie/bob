/**
 * Pull-request handler functions — pure business logic extracted from the
 * tRPC pullRequest router.
 *
 * Phase 7B-4D-beta Task 7.
 */
import { TRPCError } from "@trpc/server";
import { desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { prReviews, user } from "@bob/db/schema";

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

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

async function assertPullRequestAccess(userId: string, pullRequestId: string) {
  const pr = await getPrById(userId, pullRequestId);
  if (!pr) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Pull request not found",
    });
  }

  return pr;
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function pullRequestList(
  ctx: HandlerContext,
  input: { status?: "draft" | "open" | "merged" | "closed"; limit?: number },
) {
  return listAllPrs(ctx.userId, {
    status: input.status,
    limit: input.limit,
  });
}

export async function pullRequestGet(
  ctx: HandlerContext,
  input: { pullRequestId: string },
) {
  const pr = await getPrById(ctx.userId, input.pullRequestId);
  if (!pr) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Pull request not found",
    });
  }
  return pr;
}

export async function pullRequestListByRepository(
  ctx: HandlerContext,
  input: {
    repositoryId: string;
    status?: "draft" | "open" | "merged" | "closed";
    limit?: number;
    includeCommits?: boolean;
  },
) {
  return listPrsByRepository(ctx.userId, input.repositoryId, {
    status: input.status,
    limit: input.limit,
    includeCommits: input.includeCommits,
  });
}

export async function pullRequestListBySession(
  ctx: HandlerContext,
  input: { sessionId: string },
) {
  return listPrsBySession(ctx.userId, input.sessionId);
}

export async function pullRequestCreate(
  ctx: HandlerContext,
  input: {
    repositoryId: string;
    sessionId?: string;
    title: string;
    body?: string;
    headBranch: string;
    baseBranch?: string;
    draft?: boolean;
    planningTaskId?: string;
  },
) {
  try {
    const pr = await createDraftPr({
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
}

export async function pullRequestUpdate(
  ctx: HandlerContext,
  input: {
    pullRequestId: string;
    title?: string;
    body?: string;
    state?: "open" | "closed";
  },
) {
  try {
    return await updatePr({
      userId: ctx.userId,
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
}

export async function pullRequestMerge(
  ctx: HandlerContext,
  input: {
    pullRequestId: string;
    mergeMethod?: "merge" | "squash" | "rebase";
  },
) {
  try {
    return await mergePr({
      userId: ctx.userId,
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
}

export async function pullRequestSyncCommits(
  ctx: HandlerContext,
  input: { pullRequestId: string },
) {
  try {
    return await syncCommits({
      userId: ctx.userId,
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
}

export async function pullRequestLinkToPlanningTask(
  ctx: HandlerContext,
  input: { pullRequestId: string; planningTaskId: string },
) {
  await linkPrToPlanningTask(
    ctx.userId,
    input.pullRequestId,
    input.planningTaskId,
  );
  return { success: true };
}

export async function pullRequestRefresh(
  ctx: HandlerContext,
  input: { pullRequestId: string },
) {
  try {
    return await refreshPrFromRemote(
      ctx.userId,
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
}

export async function pullRequestListReviews(
  ctx: HandlerContext,
  input: { pullRequestId: string },
) {
  await assertPullRequestAccess(ctx.userId, input.pullRequestId);

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
}

export async function pullRequestAddReview(
  ctx: HandlerContext,
  input: {
    pullRequestId: string;
    status: "approved" | "changes_requested" | "commented";
    body?: string;
  },
) {
  await assertPullRequestAccess(ctx.userId, input.pullRequestId);

  const [review] = await db
    .insert(prReviews)
    .values({
      pullRequestId: input.pullRequestId,
      userId: ctx.userId,
      status: input.status,
      body: input.body ?? null,
    })
    .returning();
  return review;
}
