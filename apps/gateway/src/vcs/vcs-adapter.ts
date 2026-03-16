import { existsSync } from "node:fs";
import { join } from "node:path";
import { GitAdapter } from "./git-adapter.js";
import { JjAdapter } from "./jj-adapter.js";

export interface VcsAdapter {
  type: "git" | "jj";

  /** Create a new working change for a task (branch in git, change in jj) */
  createChange(opts: {
    repoPath: string;
    baseBranch: string;
    name: string;
  }): Promise<{ changeId: string }>;

  /** Get the current revision ID (HEAD SHA or jj change ID) */
  getCurrentRevId(repoPath: string): Promise<string>;

  /** Push the change to remote */
  push(opts: { repoPath: string; name: string }): Promise<void>;

  /** Get status (clean/dirty/conflicted) */
  status(repoPath: string): Promise<{ clean: boolean; conflicted: boolean }>;

  /** Describe/commit the current state */
  describe(opts: {
    repoPath: string;
    message: string;
  }): Promise<{ revId: string }>;
}

/** Auto-detect VCS type for a repo path */
export function detectVcs(repoPath: string): "git" | "jj" {
  if (existsSync(join(repoPath, ".jj"))) return "jj";
  return "git";
}

export function getVcsAdapter(repoPath: string): VcsAdapter {
  const type = detectVcs(repoPath);
  if (type === "jj") {
    return new JjAdapter();
  }
  return new GitAdapter();
}
