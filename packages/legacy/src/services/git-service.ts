import { exec } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import { promisify } from "util";

import type { AgentType, Repository, Worktree } from "../types.js";

const execAsync = promisify(exec);

export const DEFAULT_USER_ID = "default-user";

/**
 * Storage adapter interface for GitService persistence.
 * Can be implemented with SQLite, Drizzle/Postgres, or in-memory.
 */
export interface GitStorageAdapter {
  getAllRepositories(): Promise<Repository[]>;
  saveRepository(repo: Repository): Promise<void>;
  saveWorktree(worktree: Worktree): Promise<void>;
  deleteWorktree(worktreeId: string): Promise<void>;
}

/**
 * In-memory storage adapter (no persistence)
 */
export class InMemoryGitStorage implements GitStorageAdapter {
  async getAllRepositories(): Promise<Repository[]> {
    return [];
  }
  async saveRepository(_repo: Repository): Promise<void> {}
  async saveWorktree(_worktree: Worktree): Promise<void> {}
  async deleteWorktree(_worktreeId: string): Promise<void> {}
}

/**
 * User paths configuration for worktree storage
 */
export interface UserPathsConfig {
  baseDir: string;
  ensureUserDirectories(userId: string): void;
  getWorktreePath(userId: string, repoName: string, branchName: string): string;
}

/**
 * Default user paths using ~/.bob/worktrees/
 */
export class DefaultUserPaths implements UserPathsConfig {
  readonly baseDir = join(homedir(), ".bob", "worktrees");

  ensureUserDirectories(userId: string): void {
    const { mkdirSync } = require("fs");
    const userDir = join(this.baseDir, userId);
    mkdirSync(userDir, { recursive: true });
  }

  getWorktreePath(
    userId: string,
    repoName: string,
    branchName: string,
  ): string {
    // Sanitize branch name for filesystem
    const safeBranch = branchName.replace(/[\/\\:*?"<>|]/g, "-");
    return join(this.baseDir, userId, repoName, safeBranch);
  }
}

export interface GitServiceConfig {
  storage?: GitStorageAdapter;
  userPaths?: UserPathsConfig;
}

/**
 * GitService manages git repositories and worktrees.
 * Maintains in-memory cache for fast lookups, with optional persistence.
 */
export class GitService {
  private repositories = new Map<string, Repository>();
  private worktrees = new Map<string, Worktree>();
  private storage: GitStorageAdapter;
  private userPaths: UserPathsConfig;

  constructor(config: GitServiceConfig = {}) {
    this.storage = config.storage ?? new InMemoryGitStorage();
    this.userPaths = config.userPaths ?? new DefaultUserPaths();
  }

  async initialize(): Promise<void> {
    await this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    const repos = await this.storage.getAllRepositories();
    repos.forEach((repo) => {
      this.repositories.set(repo.id, repo);
      repo.worktrees.forEach((worktree) => {
        this.worktrees.set(worktree.id, worktree);
      });
    });
  }

  async addRepository(
    repositoryPath: string,
    userId?: string,
  ): Promise<Repository> {
    if (!existsSync(repositoryPath)) {
      throw new Error(`Directory ${repositoryPath} does not exist`);
    }

    const gitDir = join(repositoryPath, ".git");
    if (!existsSync(gitDir)) {
      throw new Error(`${repositoryPath} is not a git repository`);
    }

    const repo = await this.createRepositoryFromPath(repositoryPath, userId);
    if (!repo) {
      throw new Error(`Failed to create repository from ${repositoryPath}`);
    }

    this.repositories.set(repo.id, repo);
    await this.storage.saveRepository(repo);

    for (const worktree of repo.worktrees) {
      await this.storage.saveWorktree(worktree);
    }

    return repo;
  }

  private async createRepositoryFromPath(
    repoPath: string,
    userId?: string,
  ): Promise<Repository | null> {
    try {
      const { stdout: branchOutput } = await execAsync(
        "git branch --show-current",
        { cwd: repoPath },
      );
      const currentBranch = branchOutput.trim();
      const mainBranch = await this.detectMainBranch(repoPath);

      const repoId = Buffer.from(repoPath).toString("base64");
      const repo: Repository = {
        id: repoId,
        userId: userId || DEFAULT_USER_ID,
        name: basename(repoPath),
        path: repoPath,
        branch: currentBranch,
        mainBranch: mainBranch,
        worktrees: [],
      };

      const existingWorktrees = await this.loadWorktrees(repo, userId);
      repo.worktrees = existingWorktrees;

      return repo;
    } catch (error) {
      console.error(`Error creating repository from ${repoPath}:`, error);
      return null;
    }
  }

  private async detectMainBranch(repoPath: string): Promise<string> {
    try {
      // First try to get the default branch from the remote
      try {
        const { stdout: defaultBranch } = await execAsync(
          "git symbolic-ref refs/remotes/origin/HEAD",
          { cwd: repoPath },
        );
        const branch = defaultBranch.trim().replace("refs/remotes/origin/", "");
        if (branch) return branch;
      } catch {
        // If that fails, try to determine from existing branches
      }

      // Check if 'main' exists
      try {
        await execAsync("git show-ref --verify --quiet refs/heads/main", {
          cwd: repoPath,
        });
        return "main";
      } catch {
        // 'main' doesn't exist, try 'master'
      }

      // Check if 'master' exists
      try {
        await execAsync("git show-ref --verify --quiet refs/heads/master", {
          cwd: repoPath,
        });
        return "master";
      } catch {
        // Neither main nor master exists
      }

      // Try other common main branch names
      const commonNames = ["develop", "development", "dev"];
      for (const name of commonNames) {
        try {
          await execAsync(`git show-ref --verify --quiet refs/heads/${name}`, {
            cwd: repoPath,
          });
          return name;
        } catch {
          continue;
        }
      }

      // Fallback: get the current HEAD branch
      const { stdout: currentBranch } = await execAsync(
        "git branch --show-current",
        { cwd: repoPath },
      );
      return currentBranch.trim() || "main";
    } catch (error) {
      console.error(`Error detecting main branch for ${repoPath}:`, error);
      return "main";
    }
  }

  private async loadWorktrees(
    repository: Repository,
    userId?: string,
  ): Promise<Worktree[]> {
    try {
      const { stdout } = await execAsync("git worktree list --porcelain", {
        cwd: repository.path,
      });
      const worktrees: Worktree[] = [];
      const lines = stdout.trim().split("\n");

      let currentWorktree: Partial<Worktree> = {};
      let isFirstWorktree = true;
      const effectiveUserId = userId || repository.userId || DEFAULT_USER_ID;

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          const path = line.substring(9);
          currentWorktree.path = path;
        } else if (line.startsWith("branch ")) {
          const branch = line.substring(7);
          currentWorktree.branch = branch;
        } else if (line === "") {
          if (currentWorktree.path && currentWorktree.branch) {
            // Skip the main worktree - Bob should not manage it
            if (!isFirstWorktree) {
              const worktreeId = Buffer.from(currentWorktree.path).toString(
                "base64",
              );
              const worktree: Worktree = {
                id: worktreeId,
                userId: effectiveUserId,
                path: currentWorktree.path,
                branch: currentWorktree.branch,
                repositoryId: repository.id,
                instances: [],
                isMainWorktree: false,
              };
              worktrees.push(worktree);
              this.worktrees.set(worktreeId, worktree);
            }
            isFirstWorktree = false;
          }
          currentWorktree = {};
        }
      }

      // Handle the last worktree if there's no empty line at the end
      if (currentWorktree.path && currentWorktree.branch) {
        if (!isFirstWorktree) {
          const worktreeId = Buffer.from(currentWorktree.path).toString(
            "base64",
          );
          const worktree: Worktree = {
            id: worktreeId,
            userId: effectiveUserId,
            path: currentWorktree.path,
            branch: currentWorktree.branch,
            repositoryId: repository.id,
            instances: [],
            isMainWorktree: false,
          };
          worktrees.push(worktree);
          this.worktrees.set(worktreeId, worktree);
        }
      }

      return worktrees;
    } catch (error) {
      console.error(`Error loading worktrees for ${repository.path}:`, error);
      return [];
    }
  }

  async createWorktree(
    repositoryId: string,
    branchName: string,
    baseBranch?: string,
    agentType?: AgentType,
    userId?: string,
  ): Promise<Worktree> {
    const repository = this.repositories.get(repositoryId);
    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    // Auto-detect default branch if not provided
    if (!baseBranch) {
      try {
        const { stdout: defaultBranch } = await execAsync(
          "git rev-parse --abbrev-ref HEAD",
          {
            cwd: repository.path,
          },
        );
        baseBranch = defaultBranch.trim();
      } catch (error) {
        // Fallback: try main, then master
        try {
          await execAsync("git show-ref --verify --quiet refs/heads/main", {
            cwd: repository.path,
          });
          baseBranch = "main";
        } catch {
          try {
            await execAsync("git show-ref --verify --quiet refs/heads/master", {
              cwd: repository.path,
            });
            baseBranch = "master";
          } catch {
            throw new Error(
              "Could not determine default branch (tried HEAD, main, master)",
            );
          }
        }
      }
    }

    const effectiveUserId = userId || repository.userId || DEFAULT_USER_ID;
    this.userPaths.ensureUserDirectories(effectiveUserId);
    const worktreePath = this.userPaths.getWorktreePath(
      effectiveUserId,
      repository.name,
      branchName,
    );

    const worktreeId = Buffer.from(worktreePath).toString("base64");
    const preferredAgent = agentType || "claude";

    // If the worktree path already exists, return the existing worktree
    if (existsSync(worktreePath)) {
      const existing = this.worktrees.get(worktreeId);
      if (existing) {
        return existing;
      }

      // Path exists but not tracked in memory — register it
      const worktree: Worktree = {
        id: worktreeId,
        userId: effectiveUserId,
        path: worktreePath,
        branch: branchName,
        repositoryId,
        preferredAgent,
        instances: [],
        isMainWorktree: false,
      };

      this.worktrees.set(worktreeId, worktree);
      repository.worktrees.push(worktree);
      await this.storage.saveWorktree(worktree);
      return worktree;
    }

    try {
      // Check if the branch already exists
      let branchExists = false;
      try {
        await execAsync(
          `git show-ref --verify --quiet refs/heads/${branchName}`,
          { cwd: repository.path },
        );
        branchExists = true;
      } catch {
        // branch does not exist
      }

      if (branchExists) {
        // Use existing branch (no -b flag)
        await execAsync(
          `git worktree add "${worktreePath}" "${branchName}"`,
          { cwd: repository.path },
        );
      } else {
        // Create new branch from base
        await execAsync(
          `git worktree add "${worktreePath}" -b "${branchName}" "${baseBranch}"`,
          { cwd: repository.path },
        );
      }

      const worktree: Worktree = {
        id: worktreeId,
        userId: effectiveUserId,
        path: worktreePath,
        branch: branchName,
        repositoryId,
        preferredAgent,
        instances: [],
        isMainWorktree: false,
      };

      this.worktrees.set(worktreeId, worktree);
      repository.worktrees.push(worktree);

      await this.storage.saveWorktree(worktree);

      return worktree;
    } catch (error) {
      throw new Error(`Failed to create worktree: ${error}`);
    }
  }

  async checkBranchMergeStatus(
    worktreeId: string,
  ): Promise<{ isMerged: boolean; targetBranch: string }> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${worktreeId} not found`);
    }

    const repository = this.repositories.get(worktree.repositoryId);
    if (!repository) {
      throw new Error(`Repository ${worktree.repositoryId} not found`);
    }

    const branchName = worktree.branch.replace(/^refs\/heads\//, "");

    // Prefer the repository's detected default branch (origin/HEAD), then fall back to common names.
    const candidates = Array.from(
      new Set([repository.mainBranch, "main", "master"].filter(Boolean)),
    );

    let lastError: unknown;
    for (const targetBranch of candidates) {
      try {
        const { stdout: mergedOutput } = await execAsync(
          `git branch --merged ${targetBranch}`,
          { cwd: repository.path },
        );

        const isMerged = mergedOutput.includes(branchName);
        return { isMerged, targetBranch };
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`Failed to check merge status: ${lastError}`);
  }

  async removeWorktree(
    worktreeId: string,
    force: boolean = false,
  ): Promise<void> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      throw new Error(`Worktree ${worktreeId} not found`);
    }

    const repository = this.repositories.get(worktree.repositoryId);
    if (!repository) {
      throw new Error(`Repository ${worktree.repositoryId} not found`);
    }

    // Check for active instances
    const activeInstances = worktree.instances.filter(
      (i) => i.status === "running" || i.status === "starting",
    );
    if (activeInstances.length > 0 && !force) {
      throw new Error(
        "Cannot remove worktree with active instances. Stop all agent instances first.",
      );
    }

    // Check if branch is merged unless forcing deletion
    if (!force) {
      const { isMerged, targetBranch } =
        await this.checkBranchMergeStatus(worktreeId);
      if (!isMerged) {
        throw new Error(
          `Branch has not been merged into ${targetBranch}. Use force deletion if you want to delete anyway.`,
        );
      }
    }

    try {
      // If force deletion, first revert any uncommitted changes
      if (force) {
        try {
          console.log(
            `Force deletion: reverting uncommitted changes in ${worktree.path}`,
          );
          const { stdout: status } = await execAsync("git status --porcelain", {
            cwd: worktree.path,
          });

          if (status.trim()) {
            await execAsync("git reset --hard HEAD", { cwd: worktree.path });
            await execAsync("git clean -fd", { cwd: worktree.path });
            console.log(
              `Successfully reverted all changes in ${worktree.path}`,
            );
          }
        } catch (revertError) {
          console.warn(
            `Warning: Could not revert changes in ${worktree.path}: ${revertError}`,
          );
        }
      }

      await execAsync(`git worktree remove "${worktree.path}"`, {
        cwd: repository.path,
      });

      // If force deletion, delete the branch too
      if (force) {
        try {
          const branchName = worktree.branch.replace(/^refs\/heads\//, "");
          await execAsync(`git branch -D "${branchName}"`, {
            cwd: repository.path,
          });
        } catch (branchError) {
          console.warn(
            `Warning: Could not delete branch ${worktree.branch}: ${branchError}`,
          );
        }
      }

      this.worktrees.delete(worktreeId);
      repository.worktrees = repository.worktrees.filter(
        (w) => w.id !== worktreeId,
      );

      await this.storage.deleteWorktree(worktreeId);
    } catch (error) {
      throw new Error(`Failed to remove worktree: ${error}`);
    }
  }

  getRepositories(userId?: string): Repository[] {
    const repos = Array.from(this.repositories.values());
    if (userId) {
      return repos.filter(
        (r) => r.userId === userId || r.userId === DEFAULT_USER_ID,
      );
    }
    return repos;
  }

  getRepository(id: string, userId?: string): Repository | undefined {
    const repo = this.repositories.get(id);
    if (
      repo &&
      userId &&
      repo.userId !== userId &&
      repo.userId !== DEFAULT_USER_ID
    ) {
      return undefined;
    }
    return repo;
  }

  getWorktree(id: string, userId?: string): Worktree | undefined {
    const worktree = this.worktrees.get(id);
    if (
      worktree &&
      userId &&
      worktree.userId !== userId &&
      worktree.userId !== DEFAULT_USER_ID
    ) {
      return undefined;
    }
    return worktree;
  }

  getWorktreesByRepository(repositoryId: string, userId?: string): Worktree[] {
    let worktrees = Array.from(this.worktrees.values()).filter(
      (w) => w.repositoryId === repositoryId,
    );
    if (userId) {
      worktrees = worktrees.filter(
        (w) => w.userId === userId || w.userId === DEFAULT_USER_ID,
      );
    }
    return worktrees;
  }

  async refreshMainBranch(repositoryId: string): Promise<Repository> {
    const repository = this.repositories.get(repositoryId);
    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    try {
      await execAsync("git fetch origin", { cwd: repository.path });
      await execAsync(`git checkout ${repository.mainBranch}`, {
        cwd: repository.path,
      });
      await execAsync(`git pull origin ${repository.mainBranch}`, {
        cwd: repository.path,
      });

      const { stdout: branchOutput } = await execAsync(
        "git branch --show-current",
        { cwd: repository.path },
      );
      repository.branch = branchOutput.trim();
      repository.mainBranch = await this.detectMainBranch(repository.path);

      await this.storage.saveRepository(repository);

      console.log(
        `Successfully refreshed main branch for repository ${repository.name}`,
      );
      return repository;
    } catch (error) {
      console.error(
        `Error refreshing main branch for ${repository.name}:`,
        error,
      );
      throw new Error(
        `Failed to refresh main branch: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // ----- Repository Dashboard helpers -----
  async getGitRemotes(
    repositoryId: string,
  ): Promise<Array<{ name: string; url: string; type: "fetch" | "push" }>> {
    const repository = this.repositories.get(repositoryId);
    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    const { stdout } = await execAsync("git remote -v", {
      cwd: repository.path,
    });
    const lines = stdout.trim().split("\n").filter(Boolean);
    const remotes: Array<{
      name: string;
      url: string;
      type: "fetch" | "push";
    }> = [];

    for (const line of lines) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
      if (match) {
        const name = match[1];
        const url = match[2];
        const type = match[3] as "fetch" | "push";
        if (name && url) {
          remotes.push({ name, url, type });
        }
      }
    }
    return remotes;
  }

  async getGitBranches(repositoryId: string): Promise<
    Array<{
      name: string;
      isLocal: boolean;
      isRemote: boolean;
      isCurrent: boolean;
      lastCommit?: {
        hash: string;
        message: string;
        author: string;
        date: string;
      };
    }>
  > {
    const repository = this.repositories.get(repositoryId);
    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    const { stdout: currentOut } = await execAsync(
      "git branch --show-current",
      { cwd: repository.path },
    );
    const currentBranch = (currentOut || "").trim();

    const { stdout: localOut } = await execAsync(
      "git for-each-ref --sort=-committerdate --format='%(refname:short)|%(objectname)|%(authorname)|%(authordate:iso-strict)|%(contents:subject)' refs/heads",
      { cwd: repository.path },
    );

    const locals = localOut
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.replace(/^'|'$/g, "").split("|");
        const name = parts[0] ?? "";
        const hash = parts[1] ?? "";
        const author = parts[2] ?? "";
        const date = parts[3] ?? "";
        const message = parts[4] ?? "";
        return {
          name,
          isLocal: true,
          isRemote: false,
          isCurrent: name === currentBranch,
          lastCommit: { hash, message, author, date },
        };
      });

    let remotes: string[] = [];
    try {
      const { stdout: remoteOut } = await execAsync(
        "git for-each-ref --format='%(refname:short)' refs/remotes/origin",
        { cwd: repository.path },
      );
      remotes = remoteOut
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => s.replace(/^'|'$/g, ""))
        .filter((name) => !name.endsWith("/HEAD"));
    } catch {}

    const branchMap = new Map<string, any>();
    for (const b of locals) branchMap.set(b.name, b);
    for (const r of remotes) {
      const rn = r.replace(/^origin\//, "");
      if (branchMap.has(rn)) {
        branchMap.set(rn, { ...branchMap.get(rn), isRemote: true });
      } else {
        branchMap.set(rn, {
          name: rn,
          isLocal: false,
          isRemote: true,
          isCurrent: rn === currentBranch,
        });
      }
    }

    return Array.from(branchMap.values());
  }

  async getGitGraph(repositoryId: string): Promise<
    Array<{
      hash: string;
      parents: string[];
      message: string;
      author: string;
      date: string;
      branch?: string;
      x: number;
      y: number;
    }>
  > {
    const repository = this.repositories.get(repositoryId);
    if (!repository) {
      throw new Error(`Repository ${repositoryId} not found`);
    }

    const branchHeads = new Map<string, string>();
    try {
      const { stdout: headsOut } = await execAsync(
        "git for-each-ref --format='%(objectname)|%(refname:short)' refs/heads",
        { cwd: repository.path },
      );
      headsOut
        .trim()
        .split("\n")
        .filter(Boolean)
        .forEach((line) => {
          const [h, b] = line.replace(/^'|'$/g, "").split("|");
          if (h && b) branchHeads.set(h, b);
        });
    } catch {}

    const { stdout: logOut } = await execAsync(
      "git log --all --date-order --pretty=format:'%H|%P|%s|%an|%ad' --date=iso-strict -n 200",
      { cwd: repository.path },
    );

    const commits = logOut
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line, idx) => {
        const parts = line.replace(/^'|'$/g, "").split("|");
        const hash = parts[0] ?? "";
        const parentsStr = parts[1];
        const message = parts[2] ?? "";
        const author = parts[3] ?? "";
        const date = parts[4] ?? "";
        const branch = branchHeads.get(hash);
        const x = branch === repository.mainBranch ? 200 : 400;
        const y = 30 + idx * 20;
        return {
          hash,
          parents: parentsStr ? parentsStr.split(" ").filter(Boolean) : [],
          message,
          author,
          date,
          branch,
          x,
          y,
        };
      });

    return commits;
  }
}
