import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deleteFile, writeFile, writeFileOnce } from "../writer";

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
    await expect(writeFile(vaultPath, "../escape.md", "evil")).rejects.toThrow(
      "Path traversal detected",
    );
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
    await expect(deleteFile(vaultPath, "../escape.md")).rejects.toThrow(
      "Path traversal detected",
    );
  });
});

describe("writeFileOnce", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "ooda-vault-writer-once-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("creates a missing file and accepts an identical retry", async () => {
    await expect(
      writeFileOnce(vaultPath, "Content/packet.md", "same content"),
    ).resolves.toBe("created");
    await expect(
      writeFileOnce(vaultPath, "Content/packet.md", "same content"),
    ).resolves.toBe("unchanged");
  });

  it("refuses to replace a human-edited file", async () => {
    writeFileSync(join(vaultPath, "packet.md"), "human revision");

    await expect(
      writeFileOnce(vaultPath, "packet.md", "generated scaffold"),
    ).rejects.toThrow("Refusing to overwrite existing content");
    expect(readFileSync(join(vaultPath, "packet.md"), "utf-8")).toBe(
      "human revision",
    );
  });

  it("never clobbers a concurrent writer", async () => {
    const results = await Promise.allSettled([
      writeFileOnce(vaultPath, "packet.md", "first candidate"),
      writeFileOnce(vaultPath, "packet.md", "second candidate"),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(["first candidate", "second candidate"]).toContain(
      readFileSync(join(vaultPath, "packet.md"), "utf-8"),
    );
  });

  it("keeps path traversal protections", async () => {
    await expect(
      writeFileOnce(vaultPath, "../outside.md", "content"),
    ).rejects.toThrow("Path traversal detected");
  });
});
