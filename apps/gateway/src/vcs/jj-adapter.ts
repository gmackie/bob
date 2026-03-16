import { execSync } from "node:child_process";
import type { VcsAdapter } from "./vcs-adapter.js";

function jj(repoPath: string, args: string): string {
  try {
    return execSync(`jj ${args}`, { cwd: repoPath, encoding: "utf-8" }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`jj command failed (${args}): ${message}`);
  }
}

function getChangeId(repoPath: string): string {
  return jj(repoPath, "log -r @ -T change_id --no-graph");
}

export class JjAdapter implements VcsAdapter {
  type = "jj" as const;

  async createChange(opts: {
    repoPath: string;
    baseBranch: string;
    name: string;
  }): Promise<{ changeId: string }> {
    jj(opts.repoPath, `new ${opts.baseBranch}`);
    jj(opts.repoPath, `bookmark create ${opts.name} -r @`);
    const changeId = getChangeId(opts.repoPath);
    return { changeId };
  }

  async getCurrentRevId(repoPath: string): Promise<string> {
    return getChangeId(repoPath);
  }

  async push(opts: { repoPath: string; name: string }): Promise<void> {
    jj(opts.repoPath, `git push --bookmark ${opts.name} --allow-new`);
  }

  async status(repoPath: string): Promise<{ clean: boolean; conflicted: boolean }> {
    const output = jj(repoPath, "st");
    const conflicted = output.toLowerCase().includes("conflict");
    // In jj, "Working copy changes:" indicates uncommitted modifications
    const hasChanges = output.includes("Working copy changes:");
    return { clean: !hasChanges && !conflicted, conflicted };
  }

  async describe(opts: {
    repoPath: string;
    message: string;
  }): Promise<{ revId: string }> {
    // Escape double quotes in the message
    const escapedMessage = opts.message.replace(/"/g, '\\"');
    jj(opts.repoPath, `describe -m "${escapedMessage}"`);
    const revId = getChangeId(opts.repoPath);
    return { revId };
  }
}
