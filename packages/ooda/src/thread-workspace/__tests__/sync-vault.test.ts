import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import {
  initVaultRepo,
  pushVault,
  pullVault,
  hasConflicts,
  listUnpublishedVaultPublications,
  replayVaultPublications,
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

    const pushed = await pushVault(local);

    const bareLog = execSync("git log --oneline", { cwd: bare }).toString();
    expect(bareLog).toContain("test");
    expect(pushed.head.state).toBe("published");
    expect(pushed.replayed).toEqual([]);
  }, 15_000);

  it("pushVault reports pending instead of silent success when offline, then replays", async () => {
    const bare = mkdtempSync(join(tmpdir(), "ooda-bare-"));
    const local = mkdtempSync(join(tmpdir(), "ooda-local-"));
    tempDirs.push(bare, local);

    execSync("git init --bare --initial-branch=main", { cwd: bare, stdio: "pipe" });
    await initVaultRepo(local, bare);

    writeFileSync(join(local, "offline.txt"), "draft");
    execSync("git add -A", { cwd: local, stdio: "pipe" });
    execSync('git -c user.name="T" -c user.email="t@t" commit -m "offline edit"', {
      cwd: local,
      stdio: "pipe",
    });

    // Simulate the remote going away.
    const parked = `${bare}-parked`;
    renameSync(bare, parked);
    tempDirs.push(parked);

    const offline = await pushVault(local);
    expect(offline.head.state).toBe("pending");
    expect((await listUnpublishedVaultPublications(local)).map((r) => r.state)).toEqual([
      "pending",
    ]);

    // Remote comes back: replay lands the earlier intent with its original lease.
    renameSync(parked, bare);
    const replayed = await replayVaultPublications(local);
    expect(replayed.map((r) => r.state)).toEqual(["published"]);
    expect(execSync("git log --oneline", { cwd: bare }).toString()).toContain(
      "offline edit",
    );
    expect(await listUnpublishedVaultPublications(local)).toEqual([]);
  }, 20_000);

  it("reports an unavailable pull without claiming synchronization", async () => {
    const bare = mkdtempSync(join(tmpdir(), "ooda-offline-bare-"));
    const local = mkdtempSync(join(tmpdir(), "ooda-offline-local-"));
    tempDirs.push(bare, local);
    execSync("git init --bare --initial-branch=main", { cwd: bare, stdio: "pipe" });
    await initVaultRepo(local, bare);
    const before = execSync("git rev-parse HEAD", {cwd:local}).toString().trim();
    rmSync(bare,{recursive:true,force:true});
    expect(await pullVault(local)).toMatchObject({status:"unavailable",conflicts:false});
    expect(execSync("git rev-parse HEAD",{cwd:local}).toString().trim()).toBe(before);
  }, 15_000);

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

    // Pull in clone2 -- should detect conflict
    const result = await pullVault(clone2);
    expect(result.conflicts).toBe(true);

    const conflicted = await hasConflicts(clone2);
    expect(conflicted).toBe(true);
  }, 15_000);
});
