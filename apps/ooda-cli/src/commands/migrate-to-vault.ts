import { readdirSync, existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export async function migrateToVaultRepo(
  storageRoot: string,
  remoteUrl: string,
): Promise<{ migrated: string[]; skipped: string[] }> {
  const migrated: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(join(storageRoot, ".git"))) {
    execSync("git init", { cwd: storageRoot, stdio: "pipe" });
    execSync(`git remote add origin ${remoteUrl}`, {
      cwd: storageRoot,
      stdio: "pipe",
    });
  }

  for (const entry of readdirSync(storageRoot)) {
    const entryPath = join(storageRoot, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    if (entry.startsWith(".")) continue;

    const threadGit = join(entryPath, ".git");
    if (!existsSync(threadGit)) {
      skipped.push(entry);
      continue;
    }

    rmSync(threadGit, { recursive: true, force: true });
    migrated.push(entry);
  }

  if (migrated.length > 0) {
    execSync("git add -A", { cwd: storageRoot, stdio: "pipe" });
    execSync(
      `git -c user.name="OODA" -c user.email="ooda@local" commit -m "Migrate ${migrated.length} threads to vault repo"`,
      { cwd: storageRoot, stdio: "pipe" },
    );
  }

  return { migrated, skipped };
}
