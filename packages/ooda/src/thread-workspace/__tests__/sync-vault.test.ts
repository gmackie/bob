import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import {
  initVaultRepo,
  pushVault,
  pullVault,
  hasConflicts,
} from "../sync-vault";

describe("syncVault", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("initVaultRepo creates a git repo with remote", async () => {
    const bare = mkdtempSync(join(tmpdir(), "ooda-bare-"));
    const local = mkdtempSync(join(tmpdir(), "ooda-local-"));
    tempDirs.push(bare, local);

    execSync("git init --bare --initial-branch=main", { cwd: bare, stdio: "pipe" });

    await initVaultRepo(local, bare);

    const remotes = execSync("git remote -v", { cwd: local }).toString();
    expect(remotes).toContain("origin");
    expect(remotes).toContain(bare);
  });

  it("pushVault pushes commits to remote", async () => {
    const bare = mkdtempSync(join(tmpdir(), "ooda-bare-"));
    const local = mkdtempSync(join(tmpdir(), "ooda-local-"));
    tempDirs.push(bare, local);

    execSync("git init --bare --initial-branch=main", { cwd: bare, stdio: "pipe" });
    await initVaultRepo(local, bare);

    writeFileSync(join(local, "test.txt"), "hello");
    execSync("git add -A", { cwd: local, stdio: "pipe" });
    execSync('git -c user.name="T" -c user.email="t@t" commit -m "test"', {
      cwd: local,
      stdio: "pipe",
    });

    await pushVault(local);

    const bareLog = execSync("git log --oneline", { cwd: bare }).toString();
    expect(bareLog).toContain("test");
  });

  it("pullVault pulls changes and detects conflicts", async () => {
    const bare = mkdtempSync(join(tmpdir(), "ooda-bare-"));
    const clone1 = mkdtempSync(join(tmpdir(), "ooda-c1-"));
    const clone2 = mkdtempSync(join(tmpdir(), "ooda-c2-"));
    tempDirs.push(bare, clone1, clone2);

    execSync("git init --bare --initial-branch=main", { cwd: bare, stdio: "pipe" });
    await initVaultRepo(clone1, bare);

    // Create initial file and push
    writeFileSync(join(clone1, "shared.md"), "original");
    execSync("git add -A", { cwd: clone1, stdio: "pipe" });
    execSync('git -c user.name="T" -c user.email="t@t" commit -m "init"', {
      cwd: clone1,
      stdio: "pipe",
    });
    await pushVault(clone1);

    // Set up clone2 by cloning the bare repo
    rmSync(clone2, { recursive: true, force: true });
    execSync(`git clone ${bare} ${clone2}`, { stdio: "pipe" });

    // Diverge: clone1 edits, pushes
    writeFileSync(join(clone1, "shared.md"), "edit from clone1");
    execSync("git add -A", { cwd: clone1, stdio: "pipe" });
    execSync('git -c user.name="T" -c user.email="t@t" commit -m "c1 edit"', {
      cwd: clone1,
      stdio: "pipe",
    });
    await pushVault(clone1);

    // Diverge: clone2 edits same file
    writeFileSync(join(clone2, "shared.md"), "edit from clone2");
    execSync("git add -A", { cwd: clone2, stdio: "pipe" });
    execSync('git -c user.name="T" -c user.email="t@t" commit -m "c2 edit"', {
      cwd: clone2,
      stdio: "pipe",
    });

    // Pull in clone2 -- should detect conflict
    const result = await pullVault(clone2);
    expect(result.conflicts).toBe(true);

    const conflicted = await hasConflicts(clone2);
    expect(conflicted).toBe(true);
  });
});
