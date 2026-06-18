import { db } from "@bob/db/client";
import { activities, forgeRevisions } from "@bob/db/schema";

/**
 * Called when a PR is created or updated.
 * Creates a forge revision linked to the PR's head commit and records
 * an activity on the linked task (if any).
 *
 * In a real system this would also trigger a webhook or CI API call;
 * for now the revision is created with "pending" gates and CI status
 * will be updated via the existing updateBuildStatus procedure.
 */
export async function onPullRequestCreated(params: {
  pullRequestId: string;
  repositoryId: string;
  headBranch: string;
  headSha: string;
  taskId?: string;
  taskRunId?: string;
}): Promise<{ revisionId?: string }> {
  // Create a forge revision linked to this PR's head commit
  const [revision] = await db
    .insert(forgeRevisions)
    .values({
      repoId: params.repositoryId,
      revId: params.headSha,
      branch: params.headBranch,
      taskId: params.taskId ?? null,
      taskRunId: params.taskRunId ?? null,
      status: "pending",
      gates: [
        { name: "lint", status: "pending" },
        { name: "test", status: "pending" },
        { name: "build", status: "pending" },
      ],
    })
    .onConflictDoUpdate({
      target: [forgeRevisions.repoId, forgeRevisions.revId],
      set: {
        branch: params.headBranch,
        taskId: params.taskId ?? null,
        taskRunId: params.taskRunId ?? null,
        status: "pending",
        gates: [
          { name: "lint", status: "pending" },
          { name: "test", status: "pending" },
          { name: "build", status: "pending" },
        ],
      },
    })
    .returning();

  // Log activity on the linked task
  if (params.taskId) {
    await db.insert(activities).values({
      workItemId: params.taskId,
      type: "status_changed",
      toValue: "pr_created",
      metadata: {
        pullRequestId: params.pullRequestId,
        branch: params.headBranch,
        revisionId: revision?.id,
      },
    });
  }

  return { revisionId: revision?.id };
}
