import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { listFiles, readFile } from "../reader.js";

describe("reader", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vault-test-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  describe("listFiles", () => {
    it("returns .md files recursively", async () => {
      await mkdir(join(vaultPath, "sub"), { recursive: true });
      await writeFile(join(vaultPath, "root.md"), "# Root");
      await writeFile(join(vaultPath, "sub", "nested.md"), "# Nested");

      const files = await listFiles(vaultPath);

      expect(files).toEqual(["root.md", "sub/nested.md"]);
    });

    it("excludes non-md files", async () => {
      await writeFile(join(vaultPath, "note.md"), "# Note");
      await writeFile(join(vaultPath, "image.png"), "binary");
      await writeFile(join(vaultPath, "data.json"), "{}");

      const files = await listFiles(vaultPath);

      expect(files).toEqual(["note.md"]);
    });

    it("filters by glob when provided", async () => {
      await mkdir(join(vaultPath, "daily"), { recursive: true });
      await mkdir(join(vaultPath, "notes"), { recursive: true });
      await writeFile(join(vaultPath, "daily", "2026-01-01.md"), "# Day");
      await writeFile(join(vaultPath, "notes", "idea.md"), "# Idea");
      await writeFile(join(vaultPath, "readme.md"), "# Readme");

      const files = await listFiles(vaultPath, "daily/**");

      expect(files).toEqual(["daily/2026-01-01.md"]);
    });

    it("returns empty array for empty vault", async () => {
      const files = await listFiles(vaultPath);
      expect(files).toEqual([]);
    });
  });

  describe("readFile", () => {
    it("parses frontmatter correctly", async () => {
      const content = `---
title: My Note
tags:
  - test
  - vault
---

This is the body.`;
      await writeFile(join(vaultPath, "note.md"), content);

      const file = await readFile(vaultPath, "note.md");

      expect(file.relativePath).toBe("note.md");
      expect(file.name).toBe("note");
      expect(file.frontmatter).toEqual({
        title: "My Note",
        tags: ["test", "vault"],
      });
      expect(file.content.trim()).toBe("This is the body.");
    });

    it("handles files without frontmatter", async () => {
      await writeFile(join(vaultPath, "plain.md"), "Just plain text.\n");

      const file = await readFile(vaultPath, "plain.md");

      expect(file.relativePath).toBe("plain.md");
      expect(file.name).toBe("plain");
      expect(file.frontmatter).toBeNull();
      expect(file.content.trim()).toBe("Just plain text.");
    });

    it("handles nested file paths", async () => {
      await mkdir(join(vaultPath, "sub", "deep"), { recursive: true });
      await writeFile(
        join(vaultPath, "sub", "deep", "file.md"),
        "---\nkey: value\n---\nBody",
      );

      const file = await readFile(vaultPath, "sub/deep/file.md");

      expect(file.relativePath).toBe("sub/deep/file.md");
      expect(file.name).toBe("file");
      expect(file.frontmatter).toEqual({ key: "value" });
    });
  });
});
