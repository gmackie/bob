import { execSync } from "node:child_process";
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
}
