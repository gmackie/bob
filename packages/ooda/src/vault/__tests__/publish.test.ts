import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { slugify } from "../publish";

// Mock git operations so tests don't need a real git repo
vi.mock("../git.js", () => ({
  commitAndPush: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  isLocked: vi.fn().mockResolvedValue(false),
  hasConflicts: vi.fn().mockResolvedValue(false),
}));

const { publishDraft } = await import("../publish");
const { commitAndPush } = await import("../git.js");

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips non-alphanumeric characters except hyphens", () => {
    expect(slugify("My Post! (Draft #1)")).toBe("my-post-draft-1");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugify("too   many   spaces")).toBe("too-many-spaces");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("--trimmed--")).toBe("trimmed");
  });

  it("handles unicode by stripping it", () => {
    expect(slugify("caf\u00e9 latt\u00e9")).toBe("caf-latt");
  });
});

describe("publishDraft", () => {
  let websitePath: string;

  beforeEach(() => {
    websitePath = mkdtempSync(join(tmpdir(), "ooda-publish-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(websitePath, { recursive: true, force: true });
  });

  it("writes file to _drafts/ with correct slug", async () => {
    const filePath = await publishDraft(websitePath, {
      title: "My First Post",
      content: "Hello world",
      site: "gmacko",
    });

    expect(filePath).toBe("_drafts/my-first-post.md");

    const fullPath = join(websitePath, filePath);
    const raw = readFileSync(fullPath, "utf-8");
    expect(raw).toContain("Hello world");
  });

  it("generates correct Jekyll front matter", async () => {
    const filePath = await publishDraft(websitePath, {
      title: "Test Post",
      content: "Body content here",
      site: "grahammackie",
      tags: ["dev", "journal"],
      date: "2026-04-15",
    });

    const raw = readFileSync(join(websitePath, filePath), "utf-8");
    const parsed = matter(raw);

    expect(parsed.data.title).toBe("Test Post");
    expect(parsed.data.site).toBe("grahammackie");
    expect(parsed.data.tags).toEqual(["dev", "journal"]);
    expect(parsed.data.date).toBe("2026-04-15");
    expect(parsed.data.layout).toBe("post");
    expect(parsed.content.trim()).toBe("Body content here");
  });

  it("omits tags from front matter when not provided", async () => {
    const filePath = await publishDraft(websitePath, {
      title: "No Tags",
      content: "content",
      site: "gmac",
    });

    const raw = readFileSync(join(websitePath, filePath), "utf-8");
    const parsed = matter(raw);

    expect(parsed.data.tags).toBeUndefined();
  });

  it("defaults date to today when not provided", async () => {
    const filePath = await publishDraft(websitePath, {
      title: "Date Default",
      content: "content",
      site: "gmacko",
    });

    const raw = readFileSync(join(websitePath, filePath), "utf-8");
    const parsed = matter(raw);

    // Should be a YYYY-MM-DD string for today
    expect(parsed.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("commits with correct message", async () => {
    await publishDraft(websitePath, {
      title: "Commit Test",
      content: "content",
      site: "gmac",
    });

    expect(commitAndPush).toHaveBeenCalledWith(
      websitePath,
      "draft: Commit Test (gmac)",
    );
  });

  it("throws on empty slug", async () => {
    await expect(
      publishDraft(websitePath, {
        title: "!!!",
        content: "content",
        site: "gmacko",
      }),
    ).rejects.toThrow("Title produces an empty slug");
  });
});
