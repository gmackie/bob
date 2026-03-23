/**
 * Branch and PR automation for agent sessions.
 *
 * Called when an agent session starts/completes work on a planning task.
 * Creates a git branch name and, on completion, a draft PR via the
 * existing PR service.
 *
 * The actual git branch creation happens through the execution service;
 * this module records the intended branch name and orchestrates PR creation.
 */

import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { repositories, workItems } from "@bob/db/schema";

import { createDraftPr } from "../git/prService";

export interface SessionStartParams {
  sessionId: string;
  workItemId: string;
  /** Planning-side identifier like "BOB-42" */
  identifier: string;
  repositoryId: string;
}

export interface SessionCompleteParams {
  sessionId: string;
  workItemId: string;
  identifier: string;
  repositoryId: string;
  branch: string;
  userId: string;
}

/**
 * Derive a branch name from a task identifier and record it for later
 * PR creation. The actual `git branch` command is executed by the
 * execution runtime — this just provides the naming convention.
 */
export async function onSessionStart(
  params: SessionStartParams,
): Promise<{ branch: string }> {
  const branchName = `feature/${params.identifier.toLowerCase()}`;

  // The actual git branch creation happens through the execution service.
  // This returns the branch name so the caller can pass it to the runtime.
  return { branch: branchName };
}

/**
 * Called when an agent session finishes work on a task.
 * Creates a PR linking the feature branch back to the base branch.
 */
export async function onSessionComplete(
  params: SessionCompleteParams,
): Promise<{ prId?: string }> {
  if (!params.repositoryId || !params.branch) {
    return { prId: undefined };
  }

  try {
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, params.repositoryId),
    });
    if (!repo) return { prId: undefined };

    // Get work item title for PR title
    let title = `Bob: ${params.branch}`;
    if (params.workItemId) {
      const workItem = await db.query.workItems.findFirst({
        where: eq(workItems.id, params.workItemId),
      });
      if (workItem) {
        title = workItem.title;
      }
    }

    const pr = await createDraftPr({
      userId: params.userId,
      repositoryId: params.repositoryId,
      sessionId: params.sessionId,
      title,
      headBranch: params.branch,
      baseBranch: repo.mainBranch,
      draft: false,
    });

    return { prId: pr?.id };
  } catch (err) {
    console.error("[branch-automation] Failed to create PR:", err);
    return { prId: undefined };
  }
}
