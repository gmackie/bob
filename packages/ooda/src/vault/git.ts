import { access } from "node:fs/promises";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import simpleGit from "simple-git";

// ---------------------------------------------------------------------------
// Repo-scoped mutex — ensures only one git operation runs per vault path
// ---------------------------------------------------------------------------

const locks = new Map<string, Promise<void>>();

export async function acquireLock(vaultPath: string): Promise<() => void> {
  // Wait for any existing operation on this vault to complete
  while (locks.has(vaultPath)) {
    await locks.get(vaultPath);
  }

  let releaseFn!: () => void;
  const promise = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  locks.set(vaultPath, promise);

  return () => {
    locks.delete(vaultPath);
    releaseFn();
  };
}

export function releaseLock(vaultPath: string): void {
  // No-op convenience — the release function returned by acquireLock is the
  // preferred mechanism. This exists as a fallback to clear a stuck lock.
  locks.delete(vaultPath);
}

// ---------------------------------------------------------------------------
// Lock-file detection
// ---------------------------------------------------------------------------

export async function isLocked(vaultPath: string): Promise<boolean> {
  try {
    await access(join(vaultPath, ".git", "index.lock"));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

export async function hasConflicts(vaultPath: string): Promise<boolean> {
  const git = simpleGit(vaultPath);
  const result = await git.diff(["--name-only", "--diff-filter=U"]);
  return result.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Commit & push
// ---------------------------------------------------------------------------

export async function commitAndPush(
  vaultPath: string,
  message: string,
): Promise<void> {
  const release = await acquireLock(vaultPath);
  try {
    if (await isLocked(vaultPath)) {
      throw new Error(
        `Git index is locked at ${vaultPath}. Another git process may be running.`,
      );
    }

    const git = simpleGit(vaultPath);
    await git.add("-A");
    await git.commit(message);
    await git.push("origin");
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

export interface PullResult {
  filesChanged: number;
  conflicts: boolean;
}

export async function pull(vaultPath: string): Promise<PullResult> {
  const release = await acquireLock(vaultPath);
  try {
    const git = simpleGit(vaultPath);
    const pullSummary = await git.pull("origin", undefined, ["--no-rebase"]);

    const conflicts = await hasConflicts(vaultPath);

    if (conflicts) {
      // Write conflict info to .ooda/conflicts/ in the vault
      const conflictsDir = join(vaultPath, ".ooda", "conflicts");
      await mkdir(conflictsDir, { recursive: true });

      const conflictFiles = await git.diff(["--name-only", "--diff-filter=U"]);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      await writeFile(
        join(conflictsDir, `${timestamp}.txt`),
        conflictFiles.trim(),
        "utf-8",
      );
    }

    return {
      filesChanged: pullSummary.summary.changes,
      conflicts,
    };
  } finally {
    release();
  }
}
