import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deleteFile, writeFile } from "../writer";

describe("writeFile", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "ooda-vault-writer-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("creates file with correct content", async () => {
    await writeFile(vaultPath, "note.md", "hello world");

    const content = readFileSync(join(vaultPath, "note.md"), "utf-8");
    expect(content).toBe("hello world");
  });

  it("with frontmatter prepends YAML block", async () => {
    await writeFile(vaultPath, "note.md", "body text", {
      title: "My Note",
      tags: ["a", "b"],
    });

    const raw = readFileSync(join(vaultPath, "note.md"), "utf-8");
    const parsed = matter(raw);
    expect(parsed.data).toEqual({ title: "My Note", tags: ["a", "b"] });
    expect(parsed.content.trim()).toBe("body text");
  });

  it("is atomic (no .tmp file left behind on success)", async () => {
    await writeFile(vaultPath, "note.md", "content");

    expect(existsSync(join(vaultPath, "note.md"))).toBe(true);
    expect(existsSync(join(vaultPath, "note.md.tmp"))).toBe(false);
  });

  it("creates parent directories", async () => {
    await writeFile(vaultPath, "deep/nested/dir/note.md", "nested content");

    const content = readFileSync(
      join(vaultPath, "deep/nested/dir/note.md"),
      "utf-8",
    );
    expect(content).toBe("nested content");
  });

  it("rejects path traversal with ..", async () => {
    await expect(
      writeFile(vaultPath, "../escape.md", "evil"),
    ).rejects.toThrow("Path traversal detected");
  });

  it("rejects path traversal embedded in path", async () => {
    await expect(
      writeFile(vaultPath, "sub/../../../escape.md", "evil"),
    ).rejects.toThrow("Path traversal detected");
  });
});

describe("deleteFile", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "ooda-vault-writer-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("removes an existing file", async () => {
    const filePath = join(vaultPath, "to-delete.md");
    writeFileSync(filePath, "delete me");
    expect(existsSync(filePath)).toBe(true);

    await deleteFile(vaultPath, "to-delete.md");
    expect(existsSync(filePath)).toBe(false);
  });

  it("does not throw when file does not exist", async () => {
    await expect(
      deleteFile(vaultPath, "nonexistent.md"),
    ).resolves.not.toThrow();
  });

  it("rejects path traversal", async () => {
    await expect(
      deleteFile(vaultPath, "../escape.md"),
    ).rejects.toThrow("Path traversal detected");
  });
});
