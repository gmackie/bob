/**
 * A worktree that git still has on record can hold a branch hostage forever.
 *
 * `setupWorktree` removed any worktree at the PATH it was about to use, but the
 * branch can be claimed by a DIFFERENT worktree. On 2026-08-30 a leftover
 * repair worktree held
 * `bob/72be84db.../graham-meta-ads-workspace-credentials-business-app`, and
 * every dispatch for that work item died with
 *
 *   fatal: '<branch>' is already used by worktree at
 *   '/home/bob/.bob/worktrees/pulse/bob-repair-pulse-25-4f6ca310-fcbc9799'
 *
 * The runner retried across claude, codex, grok and cursor — 17 failed runs and
 * 0 completed — because it is not an agent fault and no agent could fix it.
 *
 * Worse, the blocking directory had already been DELETED from disk; only git's
 * admin record survived, so nothing on the filesystem hinted at the cause.
 *
 * These tests drive real `git` against real repositories: the bug lived
 * entirely in git's bookkeeping, so a mocked git would have proved nothing.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { releaseBranchFromStaleWorktrees } from "./worktree-prepare.js";

let root: string;
let repo: string;

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const runGit = (cwd: string, args: string[]) => Promise.resolve(git(cwd, args));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wt-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, ["init", "-b", "master"]);
  git(repo, ["config", "user.email", "t@t.t"]);
  git(repo, ["config", "user.name", "t"]);
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: repo });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("releaseBranchFromStaleWorktrees", () => {
  it("frees a branch held by a worktree whose directory was deleted", async () => {
    const stale = join(root, "stale");
    git(repo, ["worktree", "add", "-B", "feature/x", stale, "master"]);
    // The exact production shape: directory gone, git record left behind.
    rmSync(stale, { recursive: true, force: true });

    await releaseBranchFromStaleWorktrees(runGit, repo, "feature/x", join(root, "target"));

    // The whole point: adding the branch again must now succeed.
    expect(() =>
      git(repo, ["worktree", "add", "-B", "feature/x", join(root, "target"), "master"]),
    ).not.toThrow();
  });

  it("frees a branch held by a live worktree at another path", async () => {
    const other = join(root, "other");
    git(repo, ["worktree", "add", "-B", "feature/y", other, "master"]);

    await releaseBranchFromStaleWorktrees(runGit, repo, "feature/y", join(root, "target"));

    expect(() =>
      git(repo, ["worktree", "add", "-B", "feature/y", join(root, "target"), "master"]),
    ).not.toThrow();
  });

  it("leaves a worktree holding a different branch alone", async () => {
    // Only the contended branch may be released; unrelated work must survive.
    const keep = join(root, "keep");
    git(repo, ["worktree", "add", "-B", "feature/keep", keep, "master"]);

    await releaseBranchFromStaleWorktrees(runGit, repo, "feature/other", join(root, "target"));

    expect(existsSync(keep)).toBe(true);
    expect(git(repo, ["worktree", "list"])).toContain("keep");
  });

  it("does nothing when no worktree holds the branch", async () => {
    await expect(
      releaseBranchFromStaleWorktrees(runGit, repo, "feature/unused", join(root, "target")),
    ).resolves.toBeUndefined();
  });

  it("never removes the target path itself, which the caller owns", async () => {
    const target = join(root, "target");
    git(repo, ["worktree", "add", "-B", "feature/z", target, "master"]);

    await releaseBranchFromStaleWorktrees(runGit, repo, "feature/z", target);

    // setupWorktree clears the target path itself; releasing it here as well
    // would race that cleanup.
    expect(existsSync(target)).toBe(true);
  });
});
