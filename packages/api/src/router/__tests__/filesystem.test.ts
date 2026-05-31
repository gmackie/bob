import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

let createTRPCRouter: typeof import("../../trpc").createTRPCRouter;
let filesystemRouter: typeof import("../filesystem").filesystemRouter;

function hasGit() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function createCaller() {
  const router = createTRPCRouter({ filesystem: filesystemRouter });
  return router.createCaller({
    session: {
      session: {
        id: "auth-session-1",
        createdAt: new Date("2026-05-31T00:00:00.000Z"),
        updatedAt: new Date("2026-05-31T00:00:00.000Z"),
        userId: "user-1",
        expiresAt: new Date("2026-06-01T00:00:00.000Z"),
        token: "token-1",
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: "user-1",
        createdAt: new Date("2026-05-31T00:00:00.000Z"),
        updatedAt: new Date("2026-05-31T00:00:00.000Z"),
        email: "test@example.com",
        emailVerified: true,
        name: "Test User",
      },
    },
    authApi: {} as any,
    apiKeyAuth: null,
    db: {} as any,
  });
}

describe("filesystem router", () => {
  let tempDir: string;

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ createTRPCRouter } = await import("../../trpc"));
    ({ filesystemRouter } = await import("../filesystem"));
  });

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "bob-fs-router-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists visible files and hides dotfiles by default", async () => {
    mkdirSync(path.join(tempDir, "src"));
    writeFileSync(path.join(tempDir, "README.md"), "hello");
    writeFileSync(path.join(tempDir, ".env"), "secret");

    const caller = createCaller() as any;
    const visible = await caller.filesystem.list({ path: tempDir });
    const withHidden = await caller.filesystem.list({
      path: tempDir,
      showHidden: true,
    });

    expect(visible.map((entry: { name: string }) => entry.name)).toEqual([
      "src",
      "README.md",
    ]);
    expect(withHidden.map((entry: { name: string }) => entry.name)).toContain(
      ".env",
    );
  });

  it("reads, writes, moves, copies, and deletes files", async () => {
    const caller = createCaller() as any;
    const sourcePath = path.join(tempDir, "nested", "note.txt");
    const movedPath = path.join(tempDir, "moved", "note.txt");
    const copiedPath = path.join(tempDir, "copy", "note.txt");

    await caller.filesystem.write({
      path: sourcePath,
      content: "alpha",
    });
    await expect(
      caller.filesystem.read({ path: sourcePath }),
    ).resolves.toMatchObject({ content: "alpha", encoding: "utf-8" });

    await caller.filesystem.move({
      source: sourcePath,
      destination: movedPath,
    });
    await caller.filesystem.copy({
      source: movedPath,
      destination: copiedPath,
    });
    await caller.filesystem.delete({ path: movedPath });

    expect(readFileSync(copiedPath, "utf-8")).toBe("alpha");
    await expect(
      caller.filesystem.read({ path: movedPath }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("searches file names and file contents", async () => {
    const caller = createCaller() as any;
    writeFileSync(path.join(tempDir, "todo.txt"), "plain text");
    writeFileSync(path.join(tempDir, "notes.md"), "contains needle");

    const nameMatches = await caller.filesystem.search({
      path: tempDir,
      pattern: "todo",
    });
    const contentMatches = await caller.filesystem.search({
      path: tempDir,
      pattern: "needle",
    });

    expect(nameMatches.map((entry: { name: string }) => entry.name)).toEqual([
      "todo.txt",
    ]);
    expect(contentMatches.map((entry: { name: string }) => entry.name)).toEqual(
      ["notes.md"],
    );
  });

  it.skipIf(!hasGit())("returns git status entries", async () => {
    execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
    writeFileSync(path.join(tempDir, "untracked.txt"), "new");

    const caller = createCaller() as any;
    const statuses = await caller.filesystem.gitStatus({ path: tempDir });

    expect(statuses).toContainEqual({ file: "untracked.txt", status: "??" });
  });
});
