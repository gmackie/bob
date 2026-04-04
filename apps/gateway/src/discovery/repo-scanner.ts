import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

export interface DiscoveredRepo {
  name: string;
  path: string;
  isGit: boolean;
  remoteUrl?: string;
  branch?: string;
  dirty?: boolean;
  buildSystem?: string;
  forgeAppId?: string;
}

function detectBuildSystem(dirPath: string): string | undefined {
  if (existsSync(join(dirPath, "package.json"))) return "node";
  if (existsSync(join(dirPath, "go.mod"))) return "go";
  if (existsSync(join(dirPath, "Cargo.toml"))) return "rust";
  if (existsSync(join(dirPath, "Makefile"))) return "make";
  if (existsSync(join(dirPath, "pyproject.toml")) || existsSync(join(dirPath, "setup.py"))) return "python";
  if (existsSync(join(dirPath, "flake.nix"))) return "nix";
  return undefined;
}

function gitExec(repoPath: string, args: string): string | undefined {
  try {
    return execSync(`git -C "${repoPath}" ${args}`, {
      stdio: "pipe",
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    return undefined;
  }
}

export class RepoScanner {
  constructor(private devDir: string) {}

  scan(): DiscoveredRepo[] {
    if (!existsSync(this.devDir)) {
      console.warn(`[RepoScanner] DEV_DIR does not exist: ${this.devDir}`);
      return [];
    }

    const entries = readdirSync(this.devDir);
    const results: DiscoveredRepo[] = [];

    for (const entry of entries) {
      // Skip hidden directories
      if (entry.startsWith(".")) continue;

      const fullPath = join(this.devDir, entry);
      try {
        if (!statSync(fullPath).isDirectory()) continue;
      } catch {
        continue;
      }

      const isGit = existsSync(join(fullPath, ".git"));

      if (!isGit) {
        results.push({ name: entry, path: fullPath, isGit: false });
        continue;
      }

      const remoteUrl = gitExec(fullPath, "remote get-url origin");
      const branch = gitExec(fullPath, "branch --show-current");
      const porcelain = gitExec(fullPath, "status --porcelain");
      const dirty = porcelain !== undefined && porcelain.length > 0;
      const buildSystem = detectBuildSystem(fullPath);

      results.push({
        name: entry,
        path: fullPath,
        isGit: true,
        remoteUrl: remoteUrl || undefined,
        branch: branch || undefined,
        dirty,
        buildSystem,
      });
    }

    return results;
  }
}
