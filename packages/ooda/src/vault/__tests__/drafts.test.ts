import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listDrafts, writeDraft } from "../drafts.js";

describe("writeDraft", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "ooda-vault-drafts-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("creates a draft file under drafts/<kbSlug>/<id>.md", async () => {
    const draft = await writeDraft(
      vaultPath,
      { kbSlug: "sleep-science", sourceIds: [1, 2, 3] },
      "# Note body\n\nParagraph about sleep.",
    );

    expect(draft.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(draft.relativePath).toBe(
      `drafts/sleep-science/${draft.id}.md`,
    );
    expect(draft.status).toBe("pending");
    expect(existsSync(join(vaultPath, draft.relativePath))).toBe(true);
  });

  it("writes valid frontmatter + body", async () => {
    const body = "# My Findings\n\nSome text.";
    const draft = await writeDraft(
      vaultPath,
      {
        kbSlug: "cognition",
        sourceIds: [42, 43],
        createdByThreadId: "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
      },
      body,
    );

    const raw = readFileSync(join(vaultPath, draft.relativePath), "utf-8");
    const parsed = matter(raw);

    expect(parsed.data.kbSlug).toBe("cognition");
    expect(parsed.data.sourceIds).toEqual([42, 43]);
    expect(parsed.data.createdByThreadId).toBe(
      "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
    );
    expect(parsed.data.status).toBe("pending");
    // ISO 8601 timestamp (any tz; we write UTC via toISOString).
    expect(typeof parsed.data.createdAt).toBe("string");
    expect(() => new Date(parsed.data.createdAt as string)).not.toThrow();
    expect(parsed.content.trim()).toBe(body.trim());
  });

  it("omits createdByThreadId when not provided", async () => {
    const draft = await writeDraft(
      vaultPath,
      { kbSlug: "kb", sourceIds: [1] },
      "body",
    );

    const raw = readFileSync(join(vaultPath, draft.relativePath), "utf-8");
    const parsed = matter(raw);
    expect("createdByThreadId" in parsed.data).toBe(false);
    expect(draft.createdByThreadId).toBeUndefined();
  });

  it("creates parent directories on demand", async () => {
    const draft = await writeDraft(
      vaultPath,
      { kbSlug: "deep-kb", sourceIds: [9] },
      "body",
    );
    // The drafts/<kbSlug>/ directory shouldn't have existed before this call,
    // but writing should not throw.
    expect(existsSync(join(vaultPath, "drafts", "deep-kb"))).toBe(true);
    expect(existsSync(join(vaultPath, draft.relativePath))).toBe(true);
  });

  it("generates distinct ids across calls", async () => {
    const a = await writeDraft(
      vaultPath,
      { kbSlug: "kb", sourceIds: [1] },
      "a",
    );
    const b = await writeDraft(
      vaultPath,
      { kbSlug: "kb", sourceIds: [1] },
      "b",
    );
    expect(a.id).not.toBe(b.id);
  });
});

describe("listDrafts", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "ooda-vault-drafts-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("returns an empty array when drafts/ does not exist", async () => {
    const drafts = await listDrafts(vaultPath);
    expect(drafts).toEqual([]);
  });

  it("returns an empty array when a specific kbSlug has no drafts", async () => {
    // Create a draft under a DIFFERENT kb so the drafts/ root exists.
    await writeDraft(vaultPath, { kbSlug: "kb-a", sourceIds: [1] }, "a");
    const drafts = await listDrafts(vaultPath, "kb-b");
    expect(drafts).toEqual([]);
  });

  it("lists drafts across all KBs when kbSlug is omitted", async () => {
    const a = await writeDraft(
      vaultPath,
      { kbSlug: "kb-a", sourceIds: [1] },
      "a body",
    );
    const b = await writeDraft(
      vaultPath,
      { kbSlug: "kb-b", sourceIds: [2] },
      "b body",
    );

    const drafts = await listDrafts(vaultPath);
    const ids = drafts.map((d) => d.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());

    // Every entry round-trips its frontmatter.
    const byId = new Map(drafts.map((d) => [d.id, d]));
    expect(byId.get(a.id)!.kbSlug).toBe("kb-a");
    expect(byId.get(b.id)!.kbSlug).toBe("kb-b");
    expect(byId.get(a.id)!.relativePath).toBe(`drafts/kb-a/${a.id}.md`);
    expect(byId.get(b.id)!.relativePath).toBe(`drafts/kb-b/${b.id}.md`);
  });

  it("filters by kbSlug when provided", async () => {
    await writeDraft(vaultPath, { kbSlug: "kb-a", sourceIds: [1] }, "a");
    await writeDraft(vaultPath, { kbSlug: "kb-b", sourceIds: [2] }, "b");

    const drafts = await listDrafts(vaultPath, "kb-a");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.kbSlug).toBe("kb-a");
  });

  it("round-trips status + createdAt + body", async () => {
    const written = await writeDraft(
      vaultPath,
      {
        kbSlug: "kb",
        sourceIds: [1, 2],
        createdByThreadId: "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
      },
      "# Body\n\nContent.",
    );

    const [got] = await listDrafts(vaultPath, "kb");
    expect(got).toBeDefined();
    expect(got!.id).toBe(written.id);
    expect(got!.status).toBe("pending");
    expect(got!.createdAt).toBe(written.createdAt);
    expect(got!.createdByThreadId).toBe(
      "d0ae8aa6-4845-4088-af5f-bf63efd6b439",
    );
    expect(got!.sourceIds).toEqual([1, 2]);
    expect(got!.body.trim()).toBe("# Body\n\nContent.".trim());
  });

  it("skips files without draft frontmatter", async () => {
    await mkdir(join(vaultPath, "drafts", "kb"), { recursive: true });
    await fsWriteFile(
      join(vaultPath, "drafts", "kb", "stray.md"),
      "just a hand-dropped note with no frontmatter",
      "utf-8",
    );
    const real = await writeDraft(
      vaultPath,
      { kbSlug: "kb", sourceIds: [1] },
      "real",
    );

    const drafts = await listDrafts(vaultPath);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.id).toBe(real.id);
  });

  it("orders newest first", async () => {
    const older = await writeDraft(
      vaultPath,
      { kbSlug: "kb", sourceIds: [1] },
      "older",
    );
    // Advance wall clock by one millisecond so ISO strings differ.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await writeDraft(
      vaultPath,
      { kbSlug: "kb", sourceIds: [2] },
      "newer",
    );

    const drafts = await listDrafts(vaultPath, "kb");
    expect(drafts.map((d) => d.id)).toEqual([newer.id, older.id]);
  });
});
