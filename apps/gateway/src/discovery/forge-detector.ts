import { execSync } from "child_process";

export interface ForgeApp {
  id: string;
  name: string;
  slug: string;
  flakeRef?: string;
}

const FORGE_CLI = process.env.FORGE_CLI_PATH ?? `${process.env.HOME}/.forgegraph/bin/fg`;

export class ForgeDetector {
  private available: boolean;
  private cachedApps: ForgeApp[] | null = null;

  constructor() {
    this.available = this.detectCli();
  }

  private detectCli(): boolean {
    try {
      execSync(`which ${FORGE_CLI}`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  isAuthenticated(): boolean {
    if (!this.available) return false;
    try {
      execSync(`${FORGE_CLI} auth status`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  listApps(): ForgeApp[] {
    if (!this.available) return [];
    try {
      const output = execSync(`${FORGE_CLI} app list --json`, {
        stdio: "pipe",
        encoding: "utf8",
      });
      this.cachedApps = JSON.parse(output) as ForgeApp[];
      return this.cachedApps;
    } catch {
      return this.cachedApps ?? [];
    }
  }

  getCachedApps(): ForgeApp[] {
    return this.cachedApps ?? [];
  }

  extractRemoteUrl(flakeRef: string): string | null {
    const match = flakeRef.match(/git\+?(https?:\/\/[^?#]+)/);
    return match?.[1] ?? null;
  }

  /** Match a git remote URL against known forge apps */
  findAppByRemoteUrl(remoteUrl: string): ForgeApp | undefined {
    const apps = this.cachedApps ?? this.listApps();
    const normalized = remoteUrl.replace(/\.git$/, "").toLowerCase();
    return apps.find((app) => {
      if (!app.flakeRef) return false;
      const appUrl = this.extractRemoteUrl(app.flakeRef);
      if (!appUrl) return false;
      return appUrl.replace(/\.git$/, "").toLowerCase() === normalized;
    });
  }
}
