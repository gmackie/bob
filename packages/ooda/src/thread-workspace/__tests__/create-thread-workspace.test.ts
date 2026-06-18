import { describe, expect, it, afterEach } from "vitest";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { createThreadWorkspace } from "../create-thread-workspace";

function initVaultRepo(root: string) {
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync('git -c user.name="Test" -c user.email="test@test" commit --allow-empty -m "init"', {
    cwd: root,
    stdio: "pipe",
  });
}

describe("createThreadWorkspace", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("creates the thread directory layout within vault repo", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-ws-"));
    tempDirs.push(root);
    initVaultRepo(root);

    const result = await createThreadWorkspace({
      storageRoot: root,
      slug: "improve-sleep",
      title: "Improve Sleep Quality",
    });

    // No per-thread .git — git lives at vault root
    expect(existsSync(join(result.threadDir, ".git"))).toBe(false);
    expect(existsSync(join(root, ".git"))).toBe(true);

    expect(existsSync(join(result.threadDir, "notes"))).toBe(true);
    expect(existsSync(join(result.threadDir, "hypotheses"))).toBe(true);
    expect(existsSync(join(result.threadDir, "sources"))).toBe(true);
  });

  it("writes thread.json with metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-ws-"));
    tempDirs.push(root);
    initVaultRepo(root);

    const result = await createThreadWorkspace({
      storageRoot: root,
      slug: "improve-sleep",
      title: "Improve Sleep Quality",
      domainPackId: "general-research",
    });

    const meta = JSON.parse(
      readFileSync(join(result.threadDir, "thread.json"), "utf-8"),
    );

    expect(meta.title).toBe("Improve Sleep Quality");
    expect(meta.slug).toBe("improve-sleep");
    expect(meta.domainPackId).toBe("general-research");
  });

  it("commits to the vault repo (not a per-thread repo)", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-ws-"));
    tempDirs.push(root);
    initVaultRepo(root);

    await createThreadWorkspace({
      storageRoot: root,
      slug: "improve-sleep",
      title: "Improve Sleep Quality",
    });

    // Commit is at vault root level
    const log = execSync("git log --oneline", { cwd: root }).toString();
    expect(log).toContain("improve-sleep");
  });

  it("rejects duplicate slugs", async () => {
    const root = mkdtempSync(join(tmpdir(), "ooda-ws-"));
    tempDirs.push(root);
    initVaultRepo(root);

    await createThreadWorkspace({
      storageRoot: root,
      slug: "improve-sleep",
      title: "First",
    });

    await expect(
      createThreadWorkspace({
        storageRoot: root,
        slug: "improve-sleep",
        title: "Duplicate",
      }),
    ).rejects.toThrow("already exists");
  });
});
