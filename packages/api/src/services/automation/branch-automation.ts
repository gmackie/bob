/**
 * Branch and PR automation for agent sessions.
 *
 * Called when an agent session starts/completes work on a planning task.
 * Creates a git branch name and, on completion, pushes the branch and
 * creates a PR via the existing PR service.
 *
 * The actual git branch creation happens through the execution service;
 * this module records the intended branch name and orchestrates PR creation.
 */

import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, repositories, taskRuns, workItems } from "@bob/db/schema";

import { createDraftPr } from "../git/prService";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3002";

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

async function gatewayRequest(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${GATEWAY_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gateway error: ${error}`);
  }
  return response.json();
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
  return { branch: branchName };
}

/**
 * Called when an agent session finishes work on a task.
 * Pushes the feature branch to remote, then creates a PR.
 */
export async function onSessionComplete(
  params: SessionCompleteParams,
): Promise<{ prId?: string; headSha?: string }> {
  if (!params.repositoryId || !params.branch) {
    return { prId: undefined };
  }

  try {
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, params.repositoryId),
    });
    if (!repo) return { prId: undefined };

    // Find the session's working directory (may be a worktree)
    const session = await db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, params.sessionId),
    });
    const workingDir = session?.workingDirectory ?? repo.path;

    // Get the real commit SHA from the branch head
    let headSha: string | undefined;
    try {
      const revResult = await gatewayRequest("/git/log", {
        path: workingDir,
        maxCount: 1,
      }) as { commits?: Array<{ hash: string }> };
      headSha = revResult?.commits?.[0]?.hash;
    } catch {
      // If we can't get the SHA, continue with branch name as fallback
    }

    // Push the branch to remote
    try {
      await gatewayRequest("/git/push", {
        path: workingDir,
        branch: params.branch,
        setUpstream: true,
      });
      console.log(`[branch-automation] Pushed ${params.branch} to origin`);
    } catch (pushErr) {
      console.error(`[branch-automation] Push failed for ${params.branch}:`, pushErr);
      // Continue with PR creation anyway — branch may already be pushed
    }

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
      planningTaskId: params.workItemId,
    });

    // Update the task run with the real commit SHA
    if (headSha && params.sessionId) {
      await db
        .update(taskRuns)
        .set({ forgegraphRevisionId: headSha })
        .where(eq(taskRuns.sessionId, params.sessionId));
    }

    return { prId: pr?.id, headSha };
  } catch (err) {
    console.error("[branch-automation] Failed to create PR:", err);
    return { prId: undefined };
  }
}
