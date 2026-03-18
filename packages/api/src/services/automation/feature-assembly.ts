import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  activities,
  featureBranches,
  featureBranchTaskPRs,
} from "@bob/db/schema";

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

  return { ready: true, featurePrCreated: false };
}
