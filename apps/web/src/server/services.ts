import "server-only";

import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import { getAgentCommand } from "@bob/legacy";
import { agentFactory } from "@bob/legacy/agents";
import {
  AgentService,
  DEFAULT_USER_ID,
  GitService,
  TerminalService,
} from "@bob/legacy/services";

declare global {
  // Shared across Next route handlers and custom server.
  // Kept as `any` to avoid TS module identity issues.
  var __serviceManager: any;
}

class ServiceManager {
  private _gitService: GitService | null = null;
  private _agentService: AgentService | null = null;
  private _terminalService: TerminalService | null = null;
  private _initialized = false;

  private async autoDiscoverRepositories(): Promise<void> {
    if (!this._gitService) return;

    const reposDir = process.env.BOB_REPOS_DIR || join(homedir(), "bob-repos");
    if (!existsSync(reposDir)) return;

    let entries: string[];
    try {
      entries = readdirSync(reposDir);
    } catch (error) {
      console.warn(
        `[ServiceManager] Failed to read repos dir: ${reposDir}`,
        error,
      );
      return;
    }

    for (const entry of entries) {
      const repoPath = join(reposDir, entry);
      try {
        const st = statSync(repoPath);
        if (!st.isDirectory()) continue;
        if (!existsSync(join(repoPath, ".git"))) continue;

        await this._gitService.addRepository(repoPath, DEFAULT_USER_ID);
      } catch (error) {
        console.warn(`[ServiceManager] Failed to add repo: ${repoPath}`, error);
      }
    }
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;

    this._gitService = new GitService();
    await this._gitService.initialize();
    await this.autoDiscoverRepositories();

    this._agentService = new AgentService({
      gitService: this._gitService,
      agentFactory: agentFactory,
      getAgentCommand: getAgentCommand,
    });
    await this._agentService.initialize();

    this._terminalService = new TerminalService();

    this._initialized = true;
    console.log("[ServiceManager] Services initialized");
  }

  get gitService(): GitService {
    if (!this._gitService) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }
    return this._gitService;
  }

  get agentService(): AgentService {
    if (!this._agentService) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }
    return this._agentService;
  }

  get terminalService(): TerminalService {
    if (!this._terminalService) {
      throw new Error(
        "ServiceManager not initialized. Call initialize() first.",
      );
    }
    return this._terminalService;
  }

  async cleanup(): Promise<void> {
    if (this._agentService) {
      await this._agentService.cleanup();
    }
    if (this._terminalService) {
      this._terminalService.cleanup();
    }
    this._initialized = false;
  }
}

function getServiceManager(): ServiceManager {
  if (!globalThis.__serviceManager) {
    globalThis.__serviceManager = new ServiceManager();
  }
  return globalThis.__serviceManager;
}

export async function getServices() {
  const manager = getServiceManager();
  await manager.initialize();
  return {
    gitService: manager.gitService,
    agentService: manager.agentService,
    terminalService: manager.terminalService,
  };
}

export { DEFAULT_USER_ID };
