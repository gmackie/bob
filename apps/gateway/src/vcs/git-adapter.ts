import { execSync } from "node:child_process";
import { join } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import type { VcsAdapter } from "./vcs-adapter.js";

function git(repoPath: string, args: string): string {
  try {
    return execSync(`git ${args}`, { cwd: repoPath, encoding: "utf-8" }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git command failed (${args}): ${message}`);
  }
}

export class GitAdapter implements VcsAdapter {
  type = "git" as const;

  async createChange(opts: {
    repoPath: string;
    baseBranch: string;
    name: string;
  }): Promise<{ changeId: string }> {
    git(opts.repoPath, `checkout -b ${opts.name} ${opts.baseBranch}`);
    const sha = git(opts.repoPath, "rev-parse HEAD");
    return { changeId: sha };
  }

  async getCurrentRevId(repoPath: string): Promise<string> {
    return git(repoPath, "rev-parse HEAD");
  }

  async push(opts: { repoPath: string; name: string }): Promise<void> {
    git(opts.repoPath, `push -u origin ${opts.name}`);
  }

  async status(repoPath: string): Promise<{ clean: boolean; conflicted: boolean }> {
    const output = git(repoPath, "status --porcelain");
    const lines = output.split("\n").filter(Boolean);
    const conflicted = lines.some(
      (line) => line.startsWith("UU") || line.startsWith("AA") || line.startsWith("DD"),
    );
    return { clean: lines.length === 0, conflicted };
  }

  async describe(opts: {
    repoPath: string;
    message: string;
  }): Promise<{ revId: string }> {
    git(opts.repoPath, "add -A");
    // Escape double quotes in the message
    const escapedMessage = opts.message.replace(/"/g, '\\"');
    git(opts.repoPath, `commit -m "${escapedMessage}"`);
    const sha = git(opts.repoPath, "rev-parse HEAD");
    return { revId: sha };
  }

  /**
   * Create a git worktree for isolated parallel task execution.
   * Creates a new worktree directory with its own branch, sharing the
   * object store with the main repo.
   */
  async createWorktree(opts: {
    repoPath: string;
    worktreePath: string;
    branch: string;
    baseBranch: string;
  }): Promise<{ worktreePath: string; changeId: string }> {
    // Ensure worktrees parent directory exists
    const parentDir = join(opts.worktreePath, "..");
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Fetch latest from remote to ensure baseBranch is current
    try {
      git(opts.repoPath, `fetch origin ${opts.baseBranch}`);
    } catch {
      // fetch may fail if offline — continue with local state
    }

    // Create worktree with new branch based off baseBranch
    git(
      opts.repoPath,
      `worktree add -b ${opts.branch} "${opts.worktreePath}" origin/${opts.baseBranch}`,
    );

    const sha = git(opts.worktreePath, "rev-parse HEAD");
    return { worktreePath: opts.worktreePath, changeId: sha };
  }

  /**
   * Remove a git worktree and its branch.
   */
  async removeWorktree(opts: {
    repoPath: string;
    worktreePath: string;
    branch?: string;
  }): Promise<void> {
    try {
      git(opts.repoPath, `worktree remove "${opts.worktreePath}" --force`);
    } catch {
      // Worktree may already be removed — clean up manually
      if (existsSync(opts.worktreePath)) {
        rmSync(opts.worktreePath, { recursive: true, force: true });
      }
      git(opts.repoPath, "worktree prune");
    }

    // Delete the branch if specified
    if (opts.branch) {
      try {
        git(opts.repoPath, `branch -D ${opts.branch}`);
      } catch {
        // Branch may not exist or may be checked out elsewhere
      }
    }
  }
}
