import { mkdtemp, writeFile as fsWriteFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

import simpleGit from "simple-git";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { VaultService } from "../vault-service.js";
import type { VaultConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Helper: create a bare repo + working clone so commitAndPush can push
// ---------------------------------------------------------------------------

interface TestEnv {
  basePath: string;
  clonePath: string;
  config: VaultConfig;
  service: VaultService;
}

async function createTestEnv(): Promise<TestEnv> {
  const basePath = await mkdtemp(join(tmpdir(), "vault-svc-test-"));
  const barePath = join(basePath, "bare.git");
  const clonePath = join(basePath, "clone");

  // Init bare repo
  const bareGit = simpleGit();
  await bareGit.init(true, [barePath]);

  // Seed with initial commit
  const seedPath = join(basePath, "seed");
  await bareGit.clone(barePath, seedPath);
  const seedGit = simpleGit(seedPath);
  await seedGit.addConfig("user.email", "test@test.com");
  await seedGit.addConfig("user.name", "Test");
  await fsWriteFile(join(seedPath, "README.md"), "# Test Vault\n", "utf-8");
  await seedGit.add(".");
  await seedGit.commit("initial commit");
  await seedGit.push("origin", "master");

  // Clone for VaultService
  await bareGit.clone(barePath, clonePath);
  const cloneGit = simpleGit(clonePath);
  await cloneGit.addConfig("user.email", "test@test.com");
  await cloneGit.addConfig("user.name", "Test");

  const config: VaultConfig = {
    path: clonePath,
    name: "test-vault",
    kind: "personal",
  };

  return {
    basePath,
    clonePath,
    config,
    service: new VaultService(config),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VaultService", () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    await rm(env.basePath, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------

  describe("list", () => {
    it("lists .md files in the vault", async () => {
      const files = await env.service.list();
      expect(files).toContain("README.md");
    });

    it("filters by glob pattern", async () => {
      await fsWriteFile(
        join(env.clonePath, "notes.md"),
        "# Notes\n",
        "utf-8",
      );
      const files = await env.service.list("notes*");
      expect(files).toEqual(["notes.md"]);
    });
  });

  // -----------------------------------------------------------------------
  // read
  // -----------------------------------------------------------------------

  describe("read", () => {
    it("reads a file and returns VaultFile structure", async () => {
      const file = await env.service.read("README.md");
      expect(file.relativePath).toBe("README.md");
      expect(file.name).toBe("README");
      expect(file.content).toContain("# Test Vault");
    });
  });

  // -----------------------------------------------------------------------
  // write
  // -----------------------------------------------------------------------

  describe("write", () => {
    it("writes a file and commits", async () => {
      await env.service.write("daily/2026-04-15.md", "# Today\nDid stuff.\n");

      // File should exist on disk
      const fullPath = join(env.clonePath, "daily/2026-04-15.md");
      expect(existsSync(fullPath)).toBe(true);

      // Should have been committed
      const git = simpleGit(env.clonePath);
      const log = await git.log();
      expect(log.latest?.message).toBe("vault: update daily/2026-04-15.md");
    });

    it("writes with frontmatter", async () => {
      await env.service.write("test.md", "Body text", { title: "Hello" });

      const raw = readFileSync(join(env.clonePath, "test.md"), "utf-8");
      expect(raw).toContain("title: Hello");
      expect(raw).toContain("Body text");
    });
  });

  // -----------------------------------------------------------------------
  // promote
  // -----------------------------------------------------------------------

  describe("promote", () => {
    it("writes to notes/{threadId}/{noteId}.md and returns the path", async () => {
      const path = await env.service.promote(
        "thread-abc",
        "obs-001",
        "Observation content here.",
        { kind: "observation" },
      );

      expect(path).toBe("notes/thread-abc/obs-001.md");

      const fullPath = join(env.clonePath, path);
      expect(existsSync(fullPath)).toBe(true);

      const raw = readFileSync(fullPath, "utf-8");
      expect(raw).toContain("kind: observation");
      expect(raw).toContain("Observation content here.");
    });

    it("commits with the correct message", async () => {
      await env.service.promote("t1", "n1", "content");

      const git = simpleGit(env.clonePath);
      const log = await git.log();
      expect(log.latest?.message).toBe("promote: n1 from thread t1");
    });
  });

  // -----------------------------------------------------------------------
  // isHealthy
  // -----------------------------------------------------------------------

  describe("isHealthy", () => {
    it("returns true for a valid vault", async () => {
      expect(await env.service.isHealthy()).toBe(true);
    });

    it("returns false when path does not exist", async () => {
      const svc = new VaultService({
        path: "/tmp/does-not-exist-vault-xyz",
        name: "bad",
        kind: "personal",
      });
      expect(await svc.isHealthy()).toBe(false);
    });

    it("returns false when .git dir is missing", async () => {
      const noGitPath = await mkdtemp(join(tmpdir(), "vault-nogit-"));
      const svc = new VaultService({
        path: noGitPath,
        name: "no-git",
        kind: "personal",
      });

      expect(await svc.isHealthy()).toBe(false);
      await rm(noGitPath, { recursive: true, force: true });
    });

    it("returns false when index.lock exists", async () => {
      await fsWriteFile(
        join(env.clonePath, ".git", "index.lock"),
        "",
        "utf-8",
      );
      expect(await env.service.isHealthy()).toBe(false);
    });
  });
});
