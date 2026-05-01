import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import simpleGit from "simple-git";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  isLocked,
  hasConflicts,
  commitAndPush,
  pull,
  acquireLock,
} from "../git.js";

// ---------------------------------------------------------------------------
// Helper: create a bare repo + working clone for push/pull tests
// ---------------------------------------------------------------------------

interface TestRepos {
  barePath: string;
  clonePath: string;
}

async function createTestRepos(): Promise<TestRepos> {
  const base = await mkdtemp(join(tmpdir(), "vault-git-test-"));
  const barePath = join(base, "bare.git");
  const clonePath = join(base, "clone");

  // Init bare repo
  const bareGit = simpleGit();
  await bareGit.init(true, [barePath]);

  // Create a temporary repo to make an initial commit, then push to bare
  const seedPath = join(base, "seed");
  const seedGit = simpleGit();
  await seedGit.clone(barePath, seedPath);

  const seedRepo = simpleGit(seedPath);
  await seedRepo.addConfig("user.email", "test@test.com");
  await seedRepo.addConfig("user.name", "Test");
  await writeFile(join(seedPath, "README.md"), "# Test Vault\n", "utf-8");
  await seedRepo.add(".");
  await seedRepo.commit("initial commit");
  await seedRepo.push("origin", "master");

  // Clone for the actual test workspace
  await bareGit.clone(barePath, clonePath);
  const cloneGit = simpleGit(clonePath);
  await cloneGit.addConfig("user.email", "test@test.com");
  await cloneGit.addConfig("user.name", "Test");

  return { barePath, clonePath };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("git operations", () => {
  let repos: TestRepos;

  beforeEach(async () => {
    repos = await createTestRepos();
  });

  afterEach(async () => {
    // Clean up temp dirs
    const base = join(repos.clonePath, "..");
    await rm(base, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // isLocked
  // -----------------------------------------------------------------------

  describe("isLocked", () => {
    it("returns false when no index.lock exists", async () => {
      expect(await isLocked(repos.clonePath)).toBe(false);
    });

    it("returns true when index.lock exists", async () => {
      await writeFile(
        join(repos.clonePath, ".git", "index.lock"),
        "",
        "utf-8",
      );
      expect(await isLocked(repos.clonePath)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // hasConflicts
  // -----------------------------------------------------------------------

  describe("hasConflicts", () => {
    it("returns false when there are no conflicts", async () => {
      expect(await hasConflicts(repos.clonePath)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // commitAndPush
  // -----------------------------------------------------------------------

  describe("commitAndPush", () => {
    it("stages and commits files then pushes to origin", async () => {
      // Create a new file in the clone
      await writeFile(
        join(repos.clonePath, "test.md"),
        "# Test\n",
        "utf-8",
      );

      await commitAndPush(repos.clonePath, "add test file");

      // Verify the commit exists in the bare repo
      const bareGit = simpleGit(repos.barePath);
      const log = await bareGit.log();
      expect(log.latest?.message).toBe("add test file");
    });

    it("throws when index.lock exists", async () => {
      await writeFile(
        join(repos.clonePath, ".git", "index.lock"),
        "",
        "utf-8",
      );

      await expect(
        commitAndPush(repos.clonePath, "should fail"),
      ).rejects.toThrow(/locked/i);
    });
  });

  // -----------------------------------------------------------------------
  // pull
  // -----------------------------------------------------------------------

  describe("pull", () => {
    it("returns filesChanged count after pulling new changes", async () => {
      // Push a change from a second clone
      const base = join(repos.clonePath, "..");
      const clone2Path = join(base, "clone2");
      const bareGit = simpleGit();
      await bareGit.clone(repos.barePath, clone2Path);

      const clone2Git = simpleGit(clone2Path);
      await clone2Git.addConfig("user.email", "test@test.com");
      await clone2Git.addConfig("user.name", "Test");
      await writeFile(join(clone2Path, "new-file.md"), "hello\n", "utf-8");
      await clone2Git.add(".");
      await clone2Git.commit("add new file from clone2");
      await clone2Git.push("origin", "master");

      // Pull in the original clone
      const result = await pull(repos.clonePath);
      expect(result.filesChanged).toBeGreaterThanOrEqual(1);
      expect(result.conflicts).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Mutex
  // -----------------------------------------------------------------------

  describe("acquireLock mutex", () => {
    it("prevents concurrent operations — calls execute sequentially", async () => {
      const order: number[] = [];

      const op = async (id: number) => {
        const release = await acquireLock(repos.clonePath);
        order.push(id);
        // Simulate async work
        await new Promise((r) => setTimeout(r, 50));
        order.push(id * 10);
        release();
      };

      // Fire two concurrent operations
      await Promise.all([op(1), op(2)]);

      // They should have run sequentially: either [1,10,2,20] or [2,20,1,10]
      // Not interleaved like [1,2,10,20]
      const first = order[0]!;
      expect(order[1]).toBe(first * 10);
    });
  });
});
