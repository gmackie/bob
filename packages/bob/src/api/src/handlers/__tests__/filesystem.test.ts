import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { HandlerContext } from "../context";
import {
  filesystemGitStatus,
  filesystemList,
  filesystemRead,
  filesystemSearch,
  filesystemWrite,
} from "../filesystem";

const ctx = { db: {}, userId: "user-1" } as HandlerContext;

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "bob-filesystem-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("filesystem handlers", () => {
  it("writes, reads, and lists files", async () => {
    const root = makeTempDir();
    const filePath = path.join(root, "src", "hello.txt");

    await filesystemWrite(ctx, {
      path: filePath,
      content: "hello from bob",
      createDirs: true,
    });

    await expect(
      filesystemRead(ctx, { path: filePath, encoding: "utf-8" }),
    ).resolves.toEqual({ content: "hello from bob" });

    const rootEntries = await filesystemList(ctx, {
      path: root,
      showHidden: false,
    });
    expect(rootEntries).toMatchObject([
      {
        name: "src",
        path: path.join(root, "src"),
        isDirectory: true,
        isFile: false,
      },
    ]);
  });

  it("searches text files recursively", async () => {
    const root = makeTempDir();
    const filePath = path.join(root, "notes.md");

    await filesystemWrite(ctx, {
      path: filePath,
      content: "first line\nneedle here\nlast line",
    });

    await expect(
      filesystemSearch(ctx, { path: root, pattern: "needle", maxResults: 10 }),
    ).resolves.toEqual([
      {
        path: filePath,
        matches: [{ line: 2, content: "needle here" }],
      },
    ]);
  });

  it("returns porcelain git status entries with UI-compatible file aliases", async () => {
    const root = makeTempDir();
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: root,
    });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });

    const filePath = path.join(root, "README.md");
    await filesystemWrite(ctx, { path: filePath, content: "initial\n" });
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root });

    await filesystemWrite(ctx, { path: filePath, content: "changed\n" });

    await expect(
      filesystemGitStatus(ctx, { path: root }),
    ).resolves.toContainEqual({
      path: "README.md",
      file: "README.md",
      status: "M",
    });
  });
});
