/**
 * Link handler functions — pure business logic extracted from the tRPC
 * link router.
 *
 * Phase 7B-4D-beta Task 5.
 */
import { TRPCError } from "@trpc/server";
import { desc, eq, and } from "@bob/db";
import {
  worktreeLinks,
  worktrees,
} from "@bob/db/schema";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function linkList(
  ctx: HandlerContext,
  input: {
    worktreeId?: string;
    linkType?: string;
  },
) {
  const conditions = [eq(worktreeLinks.userId, ctx.userId)];
  if (input.worktreeId) {
    conditions.push(eq(worktreeLinks.worktreeId, input.worktreeId));
  }
  if (input.linkType) {
    conditions.push(eq(worktreeLinks.linkType, input.linkType as any));
  }

  const links = await ctx.db.query.worktreeLinks.findMany({
    where: and(...conditions),
    orderBy: desc(worktreeLinks.createdAt),
    with: {
      worktree: true,
    },
  });
  return links;
}

export async function linkById(
  ctx: HandlerContext,
  input: { id: string },
) {
  const link = await ctx.db.query.worktreeLinks.findFirst({
    where: and(
      eq(worktreeLinks.id, input.id),
      eq(worktreeLinks.userId, ctx.userId)
    ),
    with: {
      worktree: true,
    },
  });

  if (!link) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Link not found" });
  }

  return link;
}

export async function linkByWorktree(
  ctx: HandlerContext,
  input: { worktreeId: string },
) {
  const wt = await ctx.db.query.worktrees.findFirst({
    where: and(
      eq(worktrees.id, input.worktreeId),
      eq(worktrees.userId, ctx.userId)
    ),
  });

  if (!wt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
  }

  const links = await ctx.db.query.worktreeLinks.findMany({
    where: eq(worktreeLinks.worktreeId, input.worktreeId),
    orderBy: desc(worktreeLinks.createdAt),
  });

  return links;
}

export async function linkCreate(
  ctx: HandlerContext,
  input: {
    worktreeId: string;
    linkType: string;
    externalId?: string;
    url?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const wt = await ctx.db.query.worktrees.findFirst({
    where: and(
      eq(worktrees.id, input.worktreeId),
      eq(worktrees.userId, ctx.userId)
    ),
  });

  if (!wt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
  }

  const [link] = await ctx.db
    .insert(worktreeLinks)
    .values({
      ...input,
      userId: ctx.userId,
    })
    .returning();

  return link;
}

export async function linkUpdate(
  ctx: HandlerContext,
  input: {
    id: string;
    externalId?: string;
    url?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const { id, ...updates } = input;

  const existing = await ctx.db.query.worktreeLinks.findFirst({
    where: and(
      eq(worktreeLinks.id, id),
      eq(worktreeLinks.userId, ctx.userId)
    ),
  });

  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Link not found" });
  }

  const [updated] = await ctx.db
    .update(worktreeLinks)
    .set(updates)
    .where(eq(worktreeLinks.id, id))
    .returning();

  return updated;
}

export async function linkDelete(
  ctx: HandlerContext,
  input: { id: string },
) {
  await ctx.db
    .delete(worktreeLinks)
    .where(
      and(
        eq(worktreeLinks.id, input.id),
        eq(worktreeLinks.userId, ctx.userId)
      )
    );
  return { success: true };
}

export async function linkToPlanningTask(
  ctx: HandlerContext,
  input: {
    worktreeId: string;
    taskId: string;
    taskUrl?: string;
    taskTitle?: string;
  },
) {
  const wt = await ctx.db.query.worktrees.findFirst({
    where: and(
      eq(worktrees.id, input.worktreeId),
      eq(worktrees.userId, ctx.userId)
    ),
  });

  if (!wt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
  }

  const existing = await ctx.db.query.worktreeLinks.findFirst({
    where: and(
      eq(worktreeLinks.worktreeId, input.worktreeId),
      eq(worktreeLinks.linkType, "planning_task"),
      eq(worktreeLinks.externalId, input.taskId)
    ),
  });

  if (existing) {
    return existing;
  }

  const [link] = await ctx.db
    .insert(worktreeLinks)
    .values({
      worktreeId: input.worktreeId,
      userId: ctx.userId,
      linkType: "planning_task",
      externalId: input.taskId,
      url: input.taskUrl,
      title: input.taskTitle,
    })
    .returning();

  return link;
}

export async function linkToGitHubPR(
  ctx: HandlerContext,
  input: {
    worktreeId: string;
    prNumber: number;
    prUrl: string;
    prTitle: string;
    repoOwner: string;
    repoName: string;
  },
) {
  const wt = await ctx.db.query.worktrees.findFirst({
    where: and(
      eq(worktrees.id, input.worktreeId),
      eq(worktrees.userId, ctx.userId)
    ),
  });

  if (!wt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
  }

  const externalId = `${input.repoOwner}/${input.repoName}#${input.prNumber}`;

  const existing = await ctx.db.query.worktreeLinks.findFirst({
    where: and(
      eq(worktreeLinks.worktreeId, input.worktreeId),
      eq(worktreeLinks.linkType, "github_pr"),
      eq(worktreeLinks.externalId, externalId)
    ),
  });

  if (existing) {
    const [updated] = await ctx.db
      .update(worktreeLinks)
      .set({
        url: input.prUrl,
        title: input.prTitle,
        metadata: {
          prNumber: input.prNumber,
          repoOwner: input.repoOwner,
          repoName: input.repoName,
        },
      })
      .where(eq(worktreeLinks.id, existing.id))
      .returning();
    return updated;
  }

  const [link] = await ctx.db
    .insert(worktreeLinks)
    .values({
      worktreeId: input.worktreeId,
      userId: ctx.userId,
      linkType: "github_pr",
      externalId,
      url: input.prUrl,
      title: input.prTitle,
      metadata: {
        prNumber: input.prNumber,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
      },
    })
    .returning();

  return link;
}
