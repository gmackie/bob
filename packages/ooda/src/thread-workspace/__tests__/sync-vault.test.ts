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

    // pushVault swallows push errors (offline-tolerant by design), which
    // would otherwise turn a real push failure into a confusing downstream
    // "expected conflicts to be true" failure below. Assert the push
    // actually landed before proceeding, so a real failure here fails loud
    // and points straight at the cause.
    const bareLogAfterC1Edit = execSync("git log --oneline", { cwd: bare }).toString();
    expect(bareLogAfterC1Edit).toContain("c1 edit");

    // Diverge: clone2 edits same file
    writeFileSync(join(clone2, "shared.md"), "edit from clone2");
    execSync("git add -A", { cwd: clone2, stdio: "pipe" });
    execSync('git -c user.name="T" -c user.email="t@t" commit -m "c2 edit"', {
      cwd: clone2,
      stdio: "pipe",
    });

    // TEMP DIAGNOSTICS: this test fails only in real CI (passes locally on
    // macOS/git 2.51.1). Dump full git state before/after the pull so a CI
    // run tells us exactly what diverges, instead of guessing blind.
    console.log("=== DIAG: git --version ===", execSync("git --version").toString());
    console.log(
      "=== DIAG: bare log --oneline --all ===",
      execSync("git log --oneline --all", { cwd: bare }).toString(),
    );
    console.log(
      "=== DIAG: clone2 log --oneline --all (before pull) ===",
      execSync("git log --oneline --all", { cwd: clone2 }).toString(),
    );
    console.log(
      "=== DIAG: clone2 branch -vv (before pull) ===",
      execSync("git branch -vv", { cwd: clone2 }).toString(),
    );
    console.log(
      "=== DIAG: clone2 remote -v (before pull) ===",
      execSync("git remote -v", { cwd: clone2 }).toString(),
    );
    console.log(
      "=== DIAG: clone2 shared.md (before pull) ===",
      execSync("cat shared.md", { cwd: clone2 }).toString(),
    );

    console.log(
      "=== DIAG: git config --list --show-origin (clone2) ===",
      execSync("git config --list --show-origin", { cwd: clone2 }).toString(),
    );
    console.log(
      "=== DIAG: git config pull.ff / pull.rebase / merge.ff (global) ===",
      execSync("git config --global --get pull.ff; git config --global --get pull.rebase; git config --global --get merge.ff; echo done", {
        shell: "/bin/bash",
      }).toString(),
    );

    // TEMP DIAGNOSTIC: isolate whether this is a simple-git bug vs a genuine
    // git-level behavior difference under this environment's concurrency.
    // clone3 is a byte-for-byte copy of clone2's current diverged state;
    // run a RAW `git pull` on it (bypassing simple-git entirely) and compare
    // against what pullVault (via simple-git) does on clone2 below.
    const clone3 = mkdtempSync(join(tmpdir(), "ooda-c3-"));
    tempDirs.push(clone3);
    rmSync(clone3, { recursive: true, force: true });
    execSync(`cp -R ${clone2} ${clone3}`, { stdio: "pipe" });
    try {
      const rawOut = execSync("git pull --no-rebase", {
        cwd: clone3,
        stdio: "pipe",
      }).toString();
      console.log("=== DIAG: raw execSync git pull (clone3) SUCCEEDED, stdout ===", rawOut);
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
      console.log(
        "=== DIAG: raw execSync git pull (clone3) THREW ===",
        "stdout:", err.stdout?.toString(),
        "stderr:", err.stderr?.toString(),
        "message:", err.message,
      );
    }
    console.log(
      "=== DIAG: clone3 status (after raw pull) ===",
      execSync("git status", { cwd: clone3 }).toString(),
    );
    console.log(
      "=== DIAG: clone3 shared.md (after raw pull) ===",
      execSync("cat shared.md", { cwd: clone3 }).toString(),
    );

    // Pull in clone2 -- should detect conflict
    const result = await pullVault(clone2);
    console.log("=== DIAG: pullVault result ===", JSON.stringify(result));
    console.log(
      "=== DIAG: clone2 log --oneline --all (after pull) ===",
      execSync("git log --oneline --all", { cwd: clone2 }).toString(),
    );
    console.log(
      "=== DIAG: clone2 status (after pull) ===",
      execSync("git status", { cwd: clone2 }).toString(),
    );
    console.log(
      "=== DIAG: clone2 shared.md (after pull) ===",
      execSync("cat shared.md", { cwd: clone2 }).toString(),
    );

    expect(result.conflicts).toBe(true);

    const conflicted = await hasConflicts(clone2);
    expect(conflicted).toBe(true);
  });
});
