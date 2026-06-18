import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  activities,
  featureBranches,
  featureBranchTaskPRs,
  repositories,
} from "@bob/db/schema";

import { createDraftPr } from "../git/prService";

/**
 * Called when a task PR is merged into a feature branch.
 * Checks whether all task PRs for the feature branch are merged, and
 * if so marks the feature branch as "ready" for review.
 *
 * Actual feature PR creation requires user context, so we only flip the
 * status and let the UI prompt the user to create the feature PR via
 * featureBranch.createFeaturePR.
 */
export async function checkFeatureReadiness(params: {
  featureBranchId: string;
  userId: string;
}): Promise<{ ready: boolean; featurePrCreated: boolean }> {
  // Fetch the feature branch
  const [branch] = await db
    .select()
    .from(featureBranches)
    .where(eq(featureBranches.id, params.featureBranchId));

  if (!branch) return { ready: false, featurePrCreated: false };

  // If a feature PR already exists, no action needed
  if (branch.featurePrId) return { ready: true, featurePrCreated: false };

  // Get all task PRs for this feature branch
  const taskPRs = await db
    .select()
    .from(featureBranchTaskPRs)
    .where(eq(featureBranchTaskPRs.featureBranchId, params.featureBranchId));

  // If there are no task PRs yet, not ready
  if (taskPRs.length === 0) return { ready: false, featurePrCreated: false };

  // Check if every task PR has been merged
  const allMerged = taskPRs.every((pr) => pr.mergedAt !== null);

  if (!allMerged) return { ready: false, featurePrCreated: false };

  // All merged — update feature branch status to "ready"
  await db
    .update(featureBranches)
    .set({ status: "ready" })
    .where(eq(featureBranches.id, params.featureBranchId));

  // Log activity on the parent work item
  if (branch.workItemId) {
    await db.insert(activities).values({
      workItemId: branch.workItemId,
      type: "status_changed",
      toValue: "feature_ready",
      metadata: {
        featureBranchId: params.featureBranchId,
        branchName: branch.branchName,
        message: "All task PRs merged — feature branch ready for review",
      },
    });
  }

  // Auto-create feature PR now that all task PRs are merged
  try {
    // Look up the repository to get the userId for PR creation
    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, branch.repositoryId));

    if (!repo) {
      console.error(
        `[feature-assembly] Repository ${branch.repositoryId} not found — cannot auto-create feature PR`,
      );
      return { ready: true, featurePrCreated: false };
    }

    const pr = await createDraftPr({
      repositoryId: branch.repositoryId,
      headBranch: branch.branchName,
      baseBranch: branch.baseBranch,
      title: `Feature: ${branch.branchName}`,
      body: `Auto-created feature PR for work item. All ${taskPRs.length} task PRs merged.`,
      userId: repo.userId,
    });

    if (pr) {
      await db
        .update(featureBranches)
        .set({ featurePrId: pr.id })
        .where(eq(featureBranches.id, params.featureBranchId));
    }

    console.log(
      `[feature-assembly] Auto-created feature PR for branch ${branch.branchName}`,
    );
    return { ready: true, featurePrCreated: true };
  } catch (err) {
    console.error(`[feature-assembly] Failed to auto-create feature PR:`, err);
    // Don't block readiness — notify human to create manually
    return { ready: true, featurePrCreated: false };
  }
}
