/**
 * Free a branch that another worktree is holding, so a dispatch can create its
 * own worktree on it.
 *
 * `setupWorktree` removes any worktree sitting at the PATH it wants, but git
 * refuses `worktree add -B <branch>` when ANY other worktree claims that
 * branch. On 2026-08-30 a leftover repair worktree held one work item's branch
 * and every dispatch failed with
 *
 *   fatal: '<branch>' is already used by worktree at '<other path>'
 *
 * The runner retried across all four agents — 17 failed runs, 0 completed —
 * even though no agent could have fixed it. The blocking directory had already
 * been deleted from disk; only git's admin record survived, so nothing on the
 * filesystem explained the failure.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * git reports canonical paths (macOS resolves /var → /private/var, and hosts
 * symlink /home/bob/dev onto the data volume), so a string compare against the
 * caller's path misses and we would remove the very worktree it is building.
 */
function samePath(a: string, b: string): boolean {
  const canon = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return canon(a) === canon(b);
}

/** Runs git in `cwd` and resolves with stdout. */
export type GitRunner = (cwd: string, args: string[]) => Promise<string>;

interface WorktreeEntry {
  path: string;
  branch: string | null;
}

/** `git worktree list --porcelain` → entries. Absent branch means detached. */
function parsePorcelain(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let path: string | null = null;
  let branch: string | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (path) entries.push({ path, branch });
      path = line.slice("worktree ".length).trim();
      branch = null;
    } else if (line.startsWith("branch ")) {
      // e.g. "branch refs/heads/bob/foo"
      branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    }
  }
  if (path) entries.push({ path, branch });
  return entries;
}

/**
 * Ensure nothing but `targetPath` holds `branch`.
 *
 * Prunes first — that alone clears the common case, a worktree whose directory
 * is gone but whose record remains. Anything still holding the branch is
 * removed by path. `targetPath` is deliberately skipped: the caller clears it
 * itself, and racing that cleanup would be worse than leaving it.
 *
 * Best-effort throughout. A failure here must not block the dispatch, because
 * the `worktree add` that follows reports the real problem far better than a
 * speculative cleanup error would.
 */
export async function releaseBranchFromStaleWorktrees(
  git: GitRunner,
  repoPath: string,
  branch: string,
  targetPath: string,
): Promise<void> {
  await git(repoPath, ["worktree", "prune"]).catch(() => "");

  let listed = "";
  try {
    listed = await git(repoPath, ["worktree", "list", "--porcelain"]);
  } catch {
    return;
  }

  for (const entry of parsePorcelain(listed)) {
    if (entry.branch !== branch) continue;
    if (samePath(entry.path, targetPath)) continue;
    await git(repoPath, ["worktree", "remove", "--force", entry.path]).catch(() => "");
  }

  // A worktree removed above can leave its record behind if its directory was
  // already gone; prune again so `worktree add` sees a clean slate.
  await git(repoPath, ["worktree", "prune"]).catch(() => "");
}
