import path from 'path';
import os from 'os';
import fs from 'fs';
import { DEFAULT_USER_ID } from '../types.js';

export interface UserPaths {
  base: string;
  worktrees: string;
  config: string;
  data: string;
  cache: string;
  state: string;
  xdg: {
    config: string;
    data: string;
    state: string;
    cache: string;
  };
}

export type DeploymentMode = 'desktop' | 'server';

export class UserPathsService {
  private baseDir: string;
  private mode: DeploymentMode;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(os.homedir(), '.bob');
    this.mode = this.detectMode();
  }

  private detectMode(): DeploymentMode {
    if (process.env.BOB_MODE === 'server') return 'server';
    if (process.env.BOB_MODE === 'desktop') return 'desktop';
    if (process.env.REQUIRE_AUTH === 'true') return 'server';
    return 'desktop';
  }

  getMode(): DeploymentMode {
    return this.mode;
  }

  isServerMode(): boolean {
    return this.mode === 'server';
  }

  isDesktopMode(): boolean {
    return this.mode === 'desktop';
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  getUserPaths(userId?: string): UserPaths {
    const effectiveUserId = userId || DEFAULT_USER_ID;
    
    if (this.isDesktopMode() || effectiveUserId === DEFAULT_USER_ID) {
      return {
        base: this.baseDir,
        worktrees: this.baseDir,
        config: path.join(this.baseDir, 'config'),
        data: path.join(this.baseDir, 'data'),
        cache: path.join(this.baseDir, 'cache'),
        state: path.join(this.baseDir, 'state'),
        xdg: {
          config: path.join(os.homedir(), '.config'),
          data: path.join(os.homedir(), '.local', 'share'),
          state: path.join(os.homedir(), '.local', 'state'),
          cache: path.join(os.homedir(), '.cache')
        }
      };
    }

    const userBase = path.join(this.baseDir, 'users', effectiveUserId);
    return {
      base: userBase,
      worktrees: path.join(userBase, 'worktrees'),
      config: path.join(userBase, 'config'),
      data: path.join(userBase, 'data'),
      cache: path.join(userBase, 'cache'),
      state: path.join(userBase, 'state'),
      xdg: {
        config: path.join(userBase, 'xdg', 'config'),
        data: path.join(userBase, 'xdg', 'data'),
        state: path.join(userBase, 'xdg', 'state'),
        cache: path.join(userBase, 'xdg', 'cache')
      }
    };
  }

  getWorktreePath(userId: string | undefined, repoName: string, branchName: string): string {
    const paths = this.getUserPaths(userId);
    return path.join(paths.worktrees, `${repoName}-${branchName}`);
  }

  getUserScopedEnv(userId?: string): Record<string, string> {
    const effectiveUserId = userId || DEFAULT_USER_ID;
    
    if (this.isDesktopMode() || effectiveUserId === DEFAULT_USER_ID) {
      return {};
    }

    const paths = this.getUserPaths(userId);
    return {
      HOME: paths.base,
      XDG_CONFIG_HOME: paths.xdg.config,
      XDG_DATA_HOME: paths.xdg.data,
      XDG_STATE_HOME: paths.xdg.state,
      XDG_CACHE_HOME: paths.xdg.cache,
      BOB_USER_ID: effectiveUserId
    };
  }

  ensureUserDirectories(userId?: string): void {
    const paths = this.getUserPaths(userId);
    
    const dirs = [
      paths.base,
      paths.worktrees,
      paths.config,
      paths.data,
      paths.cache,
      paths.state,
      paths.xdg.config,
      paths.xdg.data,
      paths.xdg.state,
      paths.xdg.cache
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  validateUserAccess(userId: string, filePath: string): boolean {
    if (this.isDesktopMode()) return true;
    if (userId === DEFAULT_USER_ID) return true;

    const paths = this.getUserPaths(userId);
    const normalizedPath = path.normalize(filePath);
    const normalizedBase = path.normalize(paths.base);

    if (normalizedPath.startsWith(normalizedBase)) return true;

    const sharedPaths = [
      path.normalize(this.baseDir),
      path.normalize(path.join(this.baseDir, 'shared'))
    ];
    
    for (const shared of sharedPaths) {
      if (normalizedPath.startsWith(shared) && !normalizedPath.includes('/users/')) {
        return true;
      }
    }

    return false;
  }

  getSharedPath(...segments: string[]): string {
    return path.join(this.baseDir, 'shared', ...segments);
  }

  ensureSharedDirectories(): void {
    const sharedDirs = [
      this.getSharedPath(),
      this.getSharedPath('repos'),
      this.getSharedPath('templates')
    ];

    for (const dir of sharedDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
}

let instance: UserPathsService | null = null;

export function getUserPathsService(baseDir?: string): UserPathsService {
  if (!instance) {
    instance = new UserPathsService(baseDir);
  }
  return instance;
}

export function resetUserPathsService(): void {
  instance = null;
}
