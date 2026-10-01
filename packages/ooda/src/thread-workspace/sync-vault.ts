import { existsSync } from "node:fs";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import simpleGit, { type SimpleGit } from "simple-git";

import { acquireLock } from "../vault/git";
import { LocalGitStorage } from "../vault/local-git-storage";
import type { PublicationRecord } from "../vault/versioned-storage";

// Any git operation that might create a merge commit (a real `git pull`
// merging divergent history, not just a fast-forward) fails outright with
// "fatal: unable to auto-detect email address" when no committer identity
// is configured anywhere -- globally or locally. That failure happens
// BEFORE git writes any conflict markers to the working tree, so pullVault's
// catch-block fallback (checking hasConflicts()) sees a clean tree and
// wrongly reports conflicts: false, even though a real conflict exists.
// This bit in CI (no global git config on the runner) but not on a typical
// dev machine (which usually has ~/.gitconfig set) -- meaning any host
// without global git identity hits this in production too. Set a local
// identity on the vault repo unconditionally so merges never depend on the
// host's global git config.
async function ensureIdentity(git: SimpleGit): Promise<void> {
  await git.addConfig("user.name", "OODA", true, "local");
  await git.addConfig("user.email", "ooda@local", true, "local");
}

export async function initVaultRepo(
  vaultPath: string,
  remoteUrl: string,
): Promise<void> {
  const git = simpleGit(vaultPath);

  if (!existsSync(join(vaultPath, ".git"))) {
    await git.init(["-b", "main"]);
    await ensureIdentity(git);
    await git.addRemote("origin", remoteUrl);
    await git.raw(["commit", "--allow-empty", "-m", "Initialize vault"]);
    await git.push("origin", "main", ["--set-upstream"]);
  } else {
    await ensureIdentity(git);
    const remotes = await git.getRemotes(true);
    if (!remotes.find((r) => r.name === "origin")) {
      await git.addRemote("origin", remoteUrl);
    }
  }
}

export interface VaultPushResult {
  /** Publication of the current HEAD to its branch on origin. */
  head: PublicationRecord;
  /** Earlier publications that were replayed before HEAD was published. */
  replayed: PublicationRecord[];
}

/**
 * Publish the vault's HEAD to origin under an expected-head precondition.
 *
 * Remote failures are never swallowed into silence: the returned record's
 * `state` is `published`, `pending` (offline, replay later), `conflict`
 * (remote moved to history we do not contain) or `indeterminate`. Earlier
 * pending publications from this clone are replayed first so history lands
 * in order. Local structural failures (not a repository, detached HEAD)
 * still throw.
 */
export async function pushVault(vaultPath: string): Promise<VaultPushResult> {
  const release = await acquireLock(vaultPath);
  try {
    await ensureIdentity(simpleGit(vaultPath));
    const storage = new LocalGitStorage(vaultPath);
    const ref = await storage.currentRef();
    const revision = await storage.resolve({ ref: "HEAD" });

    const replayed = await storage.replayPending();
    const head = await storage.publish({
      ref,
      expectedHead: await storage.lastObservedRemoteHead(ref),
      revision,
    });
    return { head, replayed };
  } finally {
    release();
  }
}

/** Re-attempt publications from this clone that never reached origin. */
export async function replayVaultPublications(
  vaultPath: string,
): Promise<PublicationRecord[]> {
  const release = await acquireLock(vaultPath);
  try {
    return await new LocalGitStorage(vaultPath).replayPending();
  } finally {
    release();
  }
}

/** Publications from this clone that are not yet durably on origin. */
export async function listUnpublishedVaultPublications(
  vaultPath: string,
): Promise<PublicationRecord[]> {
  return new LocalGitStorage(vaultPath).listUnpublished();
}

export interface PullResult {
  filesChanged: number;
  conflicts: boolean;
  conflictFiles: string[];
}

export async function pullVault(vaultPath: string): Promise<PullResult> {
  const git = simpleGit(vaultPath);
  await ensureIdentity(git);

  try {
    const pullSummary = await git.pull("origin", undefined, ["--no-rebase"]);
    const conflicts = await hasConflicts(vaultPath);

    let conflictFiles: string[] = [];
    if (conflicts) {
      const raw = await git.diff(["--name-only", "--diff-filter=U"]);
      conflictFiles = raw.trim().split("\n").filter(Boolean);

      const conflictsDir = join(vaultPath, ".ooda", "conflicts");
      await mkdir(conflictsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      await writeFile(
        join(conflictsDir, `${timestamp}.txt`),
        conflictFiles.join("\n"),
        "utf-8",
      );
    }

    return {
      filesChanged: pullSummary.summary.changes,
      conflicts,
      conflictFiles,
    };
  } catch {
    // Pull failed -- check if it left merge conflicts
    const conflicts = await hasConflicts(vaultPath);
    if (conflicts) {
      const raw = await git.diff(["--name-only", "--diff-filter=U"]);
      const conflictFiles = raw.trim().split("\n").filter(Boolean);

      const conflictsDir = join(vaultPath, ".ooda", "conflicts");
      await mkdir(conflictsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      await writeFile(
        join(conflictsDir, `${timestamp}.txt`),
        conflictFiles.join("\n"),
        "utf-8",
      );

      return { filesChanged: 0, conflicts: true, conflictFiles };
    }
    return { filesChanged: 0, conflicts: false, conflictFiles: [] };
  }
}

export async function hasConflicts(vaultPath: string): Promise<boolean> {
  const git = simpleGit(vaultPath);
  const result = await git.diff(["--name-only", "--diff-filter=U"]);
  return result.trim().length > 0;
}

export async function getConflictedThreads(
  vaultPath: string,
): Promise<string[]> {
  const git = simpleGit(vaultPath);
  const raw = await git.diff(["--name-only", "--diff-filter=U"]);
  const files = raw.trim().split("\n").filter(Boolean);
  const slugs = new Set(files.map((f) => f.split("/")[0]!));
  return [...slugs];
}

export async function resolveConflict(
  vaultPath: string,
  filePath: string,
): Promise<void> {
  const git = simpleGit(vaultPath);
  await git.add(filePath);
}

export async function commitMerge(vaultPath: string): Promise<void> {
  const git = simpleGit(vaultPath);
  await git.raw([
    "-c",
    "user.name=OODA",
    "-c",
    "user.email=ooda@local",
    "commit",
    "--no-edit",
  ]);
}

export async function abortMerge(vaultPath: string): Promise<void> {
  const git = simpleGit(vaultPath);
  await git.merge(["--abort"]);
}
