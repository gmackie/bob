/**
 * Feature branch handler functions — pure business logic extracted from the
 * tRPC featureBranch router.
 *
 * Phase 7B-4D-beta Task 4.
 */
import { TRPCError } from "@trpc/server";
import { and, count, eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  featureBranches,
  featureBranchTaskPRs,
  pullRequests,
  workItems,
  workspaceMembers,
} from "@bob/db/schema";

import { createDraftPr } from "../services/git/prService";
import { checkFeatureReadiness } from "../services/automation/feature-assembly";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helpers (moved verbatim from the router)
// ---------------------------------------------------------------------------

async function assertWorkspaceAccess(userId: string, workspaceId: string) {
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

async function loadAccessibleWorkItem(userId: string, workItemId: string) {
  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
    columns: { id: true, workspaceId: true },
  });

  if (!workItem?.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await assertWorkspaceAccess(userId, workItem.workspaceId);
  return workItem;
}

async function loadAccessibleFeatureBranch(userId: string, featureBranchId: string) {
  const branch = await db.query.featureBranches.findFirst({
    where: eq(featureBranches.id, featureBranchId),
  });

  if (!branch) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await loadAccessibleWorkItem(userId, branch.workItemId);
  return branch;
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function featureBranchCreate(
  ctx: HandlerContext,
  input: {
    workItemId: string;
    repositoryId: string;
    branchName: string;
    baseBranch?: string;
  },
) {
  await loadAccessibleWorkItem(ctx.userId, input.workItemId);

  const [branch] = await db
    .insert(featureBranches)
    .values({
      workItemId: input.workItemId,
      repositoryId: input.repositoryId,
      branchName: input.branchName,
      baseBranch: input.baseBranch ?? "main",
    })
    .returning();
  return branch;
}

export async function featureBranchGet(
  ctx: HandlerContext,
  input: { id: string },
) {
  const branch = await loadAccessibleFeatureBranch(ctx.userId, input.id);

  const taskPRs = await db
    .select({
      id: featureBranchTaskPRs.id,
      featureBranchId: featureBranchTaskPRs.featureBranchId,
      pullRequestId: featureBranchTaskPRs.pullRequestId,
      mergedAt: featureBranchTaskPRs.mergedAt,
      createdAt: featureBranchTaskPRs.createdAt,
      pullRequest: pullRequests,
    })
    .from(featureBranchTaskPRs)
    .leftJoin(
      pullRequests,
      eq(featureBranchTaskPRs.pullRequestId, pullRequests.id),
    )
    .where(eq(featureBranchTaskPRs.featureBranchId, input.id));

  return { ...branch, taskPRs };
}

export async function featureBranchList(
  ctx: HandlerContext,
  input: { workItemId: string },
) {
  await loadAccessibleWorkItem(ctx.userId, input.workItemId);

  const branches = await db
    .select({
      id: featureBranches.id,
      workItemId: featureBranches.workItemId,
      repositoryId: featureBranches.repositoryId,
      branchName: featureBranches.branchName,
      baseBranch: featureBranches.baseBranch,
      status: featureBranches.status,
      featurePrId: featureBranches.featurePrId,
      createdAt: featureBranches.createdAt,
      taskPRCount: count(featureBranchTaskPRs.id),
    })
    .from(featureBranches)
    .leftJoin(
      featureBranchTaskPRs,
      eq(featureBranches.id, featureBranchTaskPRs.featureBranchId),
    )
    .where(eq(featureBranches.workItemId, input.workItemId))
    .groupBy(featureBranches.id);

  return branches;
}

export async function featureBranchAddTaskPR(
  ctx: HandlerContext,
  input: { featureBranchId: string; pullRequestId: string },
) {
  await loadAccessibleFeatureBranch(ctx.userId, input.featureBranchId);

  const [record] = await db
    .insert(featureBranchTaskPRs)
    .values({
      featureBranchId: input.featureBranchId,
      pullRequestId: input.pullRequestId,
    })
    .returning();
  return record;
}

export async function featureBranchMarkTaskPRMerged(
  ctx: HandlerContext,
  input: { featureBranchId: string; pullRequestId: string },
) {
  await loadAccessibleFeatureBranch(ctx.userId, input.featureBranchId);

  const [updated] = await db
    .update(featureBranchTaskPRs)
    .set({ mergedAt: new Date().toISOString() })
    .where(
      and(
        eq(featureBranchTaskPRs.featureBranchId, input.featureBranchId),
        eq(featureBranchTaskPRs.pullRequestId, input.pullRequestId),
      ),
    )
    .returning();

  // Fire-and-forget: check if all task PRs are merged → mark feature ready
  checkFeatureReadiness({
    featureBranchId: input.featureBranchId,
    userId: ctx.userId,
  }).catch(() => {
    // Intentionally swallowed — readiness check is best-effort
  });

  return updated;
}

export async function featureBranchCreateFeaturePR(
  ctx: HandlerContext,
  input: { featureBranchId: string; title: string; repositoryId: string },
) {
  await loadAccessibleFeatureBranch(ctx.userId, input.featureBranchId);

  // Get the feature branch to find branchName and baseBranch
  const [branch] = await db
    .select()
    .from(featureBranches)
    .where(eq(featureBranches.id, input.featureBranchId));

  if (!branch) {
    throw new Error("Feature branch not found");
  }

  // Create the PR via the existing service
  let pr;
  try {
    pr = await createDraftPr({
      userId: ctx.userId,
      repositoryId: input.repositoryId,
      title: input.title,
      headBranch: branch.branchName,
      baseBranch: branch.baseBranch,
      draft: false,
    });
  } catch (err) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create pull request for feature branch",
      cause: err,
    });
  }

  // Link the PR back to the feature branch
  const [updated] = await db
    .update(featureBranches)
    .set({ featurePrId: pr.id })
    .where(eq(featureBranches.id, input.featureBranchId))
    .returning();

  return { featureBranch: updated, pullRequest: pr };
}

export async function featureBranchUpdateStatus(
  ctx: HandlerContext,
  input: { id: string; status: "active" | "ready" | "merged" | "abandoned" },
) {
  await loadAccessibleFeatureBranch(ctx.userId, input.id);

  const [updated] = await db
    .update(featureBranches)
    .set({ status: input.status })
    .where(eq(featureBranches.id, input.id))
    .returning();
  return updated;
}
