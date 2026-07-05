/**
 * Repository handler functions — pure business logic extracted from the
 * tRPC repository router.
 *
 * Phase 7B-4D-beta Task 7.
 */
import { TRPCError } from "@trpc/server";
import { desc, eq, and } from "@bob/db";
import type { Db } from "@bob/db/client";
import {
  repositories,
  worktrees,
  agentInstances,
  worktreePlans,
  projects,
  workspaceMembers,
} from "@bob/db/schema";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

async function assertProjectAccess(db: Db, userId: string, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { id: true, workspaceId: true },
  });

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, project.workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function repositoryList(ctx: HandlerContext) {
  const repos = await ctx.db.query.repositories.findMany({
    where: eq(repositories.userId, ctx.userId),
    orderBy: desc(repositories.createdAt),
    with: {
      worktrees: {
        with: {
          instances: true,
        },
      },
    },
  });
  return repos;
}

export async function repositoryById(
  ctx: HandlerContext,
  input: { id: string },
) {
  const repo = await ctx.db.query.repositories.findFirst({
    where: and(
      eq(repositories.id, input.id),
      eq(repositories.userId, ctx.userId)
    ),
    with: {
      worktrees: {
        with: {
          instances: true,
        },
      },
    },
  });

  if (!repo) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
  }

  return repo;
}

export async function repositoryAdd(
  ctx: HandlerContext,
  input: { repositoryPath: string },
) {
  const [repo] = await ctx.db
    .insert(repositories)
    .values({
      userId: ctx.userId,
      name: input.repositoryPath.split("/").pop() ?? "unknown",
      path: input.repositoryPath,
      branch: "main",
      mainBranch: "main",
    })
    .returning();

  return repo;
}

export async function repositoryAddFromProvider(
  ctx: HandlerContext,
  input: {
    fullName: string;
    cloneUrl: string;
    htmlUrl: string;
    defaultBranch: string;
    provider?: string;
    instanceUrl?: string;
    projectId?: string;
  },
) {
  if (input.projectId) {
    await assertProjectAccess(ctx.db, ctx.userId, input.projectId);
  }

  const [owner, name] = input.fullName.split("/");
  const repoName = name ?? input.fullName;
  const localPath = `/home/${process.env.USER ?? "mackieg"}/repos/${repoName}`;

  // Check if already registered
  const existing = await ctx.db.query.repositories.findFirst({
    where: and(
      eq(repositories.userId, ctx.userId),
      eq(repositories.remoteOwner, owner ?? ""),
      eq(repositories.remoteName, repoName),
    ),
  });

  if (existing) {
    return existing;
  }

  // The Go daemon handles git clone on the node when it discovers
  // the registered repo. We just register the metadata here.

  const [repo] = await ctx.db
    .insert(repositories)
    .values({
      userId: ctx.userId,
      name: repoName,
      path: localPath,
      branch: input.defaultBranch,
      mainBranch: input.defaultBranch,
      remoteUrl: input.cloneUrl,
      remoteOwner: owner ?? "",
      remoteName: repoName,
      remoteProvider: input.provider ?? null,
      remoteInstanceUrl: input.instanceUrl ?? null,
      planningProjectId: input.projectId ?? null,
    })
    .returning();

  console.log(
    `[repository] Registered ${input.fullName} at ${localPath}`,
  );

  return repo;
}

export async function repositoryDelete(
  ctx: HandlerContext,
  input: { id: string },
) {
  await ctx.db
    .delete(repositories)
    .where(
      and(
        eq(repositories.id, input.id),
        eq(repositories.userId, ctx.userId)
      )
    );
  return { success: true };
}

export async function repositoryRefreshMainBranch(
  ctx: HandlerContext,
  input: { id: string },
) {
  const repo = await ctx.db.query.repositories.findFirst({
    where: and(
      eq(repositories.id, input.id),
      eq(repositories.userId, ctx.userId)
    ),
  });

  if (!repo) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
  }

  return repo;
}

export async function repositoryGetWorktrees(
  ctx: HandlerContext,
  input: { repositoryId: string },
) {
  const wts = await ctx.db.query.worktrees.findMany({
    where: and(
      eq(worktrees.repositoryId, input.repositoryId),
      eq(worktrees.userId, ctx.userId)
    ),
    orderBy: desc(worktrees.createdAt),
    with: {
      instances: true,
    },
  });
  return wts;
}

export async function repositoryCreateWorktree(
  ctx: HandlerContext,
  input: {
    repositoryId: string;
    branchName: string;
    baseBranch?: string;
    agentType: string;
    planning?: {
      title?: string;
      goal?: string;
      planningTaskId?: string;
      tasks?: {
        key: string;
        content: string;
        status?: "pending" | "in_progress" | "completed" | "cancelled";
      }[];
    };
  },
) {
  const repo = await ctx.db.query.repositories.findFirst({
    where: and(
      eq(repositories.id, input.repositoryId),
      eq(repositories.userId, ctx.userId)
    ),
  });

  if (!repo) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
  }

  const worktreePath = `~/.bob/${repo.name}-${input.branchName}`;

  const [wt] = await ctx.db
    .insert(worktrees)
    .values({
      userId: ctx.userId,
      repositoryId: input.repositoryId,
      path: worktreePath,
      branch: input.branchName,
      preferredAgent: input.agentType,
      isMainWorktree: false,
    })
    .returning();

  if (!wt) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create worktree" });
  }

  if (input.planning) {
    const planningPath = `${worktreePath}/planning.md`;

    // The planning.md file will be written by the Go daemon when it
    // sets up the worktree. We store the content in the DB for now.

    await ctx.db.insert(worktreePlans).values({
      worktreeId: wt.id,
      userId: ctx.userId,
      filePath: planningPath,
      title: input.planning.title,
      goal: input.planning.goal,
      status: "active",
      planningTaskId: input.planning.planningTaskId,
      lastSyncedAt: new Date().toISOString(),
    });
  }

  return wt;
}

export async function repositoryGetWorktreePlanning(
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

  const plan = await ctx.db.query.worktreePlans.findFirst({
    where: eq(worktreePlans.worktreeId, input.worktreeId),
  });

  const planningPath = plan?.filePath ?? `${wt.path}/planning.md`;

  // File reads now go through the Go daemon, not the old gateway.
  // Return what we have in the DB.
  return {
    exists: !!plan,
    path: planningPath,
    content: null,
    parsed: plan ? { frontmatter: {}, title: plan.title ?? undefined, goal: plan.goal ?? undefined, tasks: [] } : null,
    dbRecord: plan,
  };
}

export async function repositoryUpdateWorktreePlanning(
  ctx: HandlerContext,
  input: {
    worktreeId: string;
    content?: string;
    title?: string;
    goal?: string;
    status?: string;
    planningTaskId?: string | null;
    tasks?: {
      key: string;
      content: string;
      status?: "pending" | "in_progress" | "completed" | "cancelled";
    }[];
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

  let plan = await ctx.db.query.worktreePlans.findFirst({
    where: eq(worktreePlans.worktreeId, input.worktreeId),
  });

  const planningPath = plan?.filePath ?? `${wt.path}/planning.md`;

  // File writes now go through the Go daemon. The DB record is
  // updated here; the daemon syncs it to disk when it runs.

  if (!plan) {
    const [newPlan] = await ctx.db
      .insert(worktreePlans)
      .values({
        worktreeId: input.worktreeId,
        userId: ctx.userId,
        filePath: planningPath,
        title: input.title,
        goal: input.goal,
        status: input.status ?? "active",
        planningTaskId: input.planningTaskId,
        lastSyncedAt: new Date().toISOString(),
      })
      .returning();
    plan = newPlan;
  } else {
    const updates: Record<string, unknown> = { lastSyncedAt: new Date().toISOString() };
    if (input.title !== undefined) updates.title = input.title;
    if (input.goal !== undefined) updates.goal = input.goal;
    if (input.status !== undefined) updates.status = input.status;
    if (input.planningTaskId !== undefined) {
      updates.planningTaskId = input.planningTaskId;
    }

    const [updated] = await ctx.db
      .update(worktreePlans)
      .set(updates)
      .where(eq(worktreePlans.id, plan.id))
      .returning();
    plan = updated;
  }

  return {
    success: true,
    plan,
    path: planningPath,
  };
}

export async function repositoryDeleteWorktree(
  ctx: HandlerContext,
  input: { worktreeId: string; force?: boolean },
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

  if (input.force) {
    await ctx.db
      .delete(agentInstances)
      .where(eq(agentInstances.worktreeId, input.worktreeId));
  }

  await ctx.db.delete(worktrees).where(eq(worktrees.id, input.worktreeId));

  return { success: true };
}

export async function repositoryGetWorktreeMergeStatus(
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

  return { merged: false, hasUncommittedChanges: false };
}
