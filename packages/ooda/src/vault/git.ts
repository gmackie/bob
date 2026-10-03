import { access } from "node:fs/promises";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import simpleGit from "simple-git";

import { LocalGitStorage } from "./local-git-storage";
import type { PublicationRecord } from "./versioned-storage";

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
// Commit & publish
// ---------------------------------------------------------------------------

export interface CommitAndPushOptions {
  /** Explicit server-owned composition; never chosen by request input. */
  storage?: import("./versioned-storage").VersionedStoragePort & Pick<LocalGitStorage, "currentRef" | "lastObservedRemoteHead">;
  /** Stable id for retrying the same publication. Generated when omitted. */
  operationId?: string;
}

/**
 * Stage and commit all working-tree changes, replay any earlier publication
 * that never reached the remote, then publish HEAD to its branch under an
 * expected-head precondition.
 *
 * Remote outcomes are returned, not thrown: inspect `state` before telling
 * anyone the change is durably published. Local failures (index lock, not a
 * repository, nothing resolvable) still throw.
 */
export async function commitAndPush(
  vaultPath: string,
  message: string,
  options: CommitAndPushOptions = {},
): Promise<PublicationRecord> {
  const release = await acquireLock(vaultPath);
  try {
    if (await isLocked(vaultPath)) {
      throw new Error(
        `Git index is locked at ${vaultPath}. Another git process may be running.`,
      );
    }

    const storage = options.storage ?? new LocalGitStorage(vaultPath);
    const committed = await storage.commitWorkingTree(message);
    const revision = committed ?? (await storage.resolve({ ref: "HEAD" }));
    const ref = await storage.currentRef();

    await storage.replayPending();

    return storage.publish({
      ref,
      expectedHead: await storage.lastObservedRemoteHead(ref),
      revision,
      ...(options.operationId !== undefined
        ? { operationId: options.operationId }
        : {}),
    });
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
