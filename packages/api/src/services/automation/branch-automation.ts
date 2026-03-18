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
 * Creates a draft PR linking the feature branch back to the base branch.
 *
 * This is a stub — real PR creation will be wired in a future iteration
 * once the execution runtime reliably reports branch + commit info.
 */
export async function onSessionComplete(
  params: SessionCompleteParams,
): Promise<{ prId?: string }> {
  // Future: use createDraftPr from ../git/prService to open a draft PR.
  // For now we just return undefined so callers know no PR was created yet.
  void params; // suppress unused warning
  return { prId: undefined };
}
