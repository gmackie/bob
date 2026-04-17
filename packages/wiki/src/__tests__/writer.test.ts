import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeArticle, type WikiArticle } from "../writer";
import { readFile, rm, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import matter from "gray-matter";

describe("writeArticle", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "wiki-test-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  const baseArticle: WikiArticle = {
    title: "Test Article",
    slug: "test-article",
    content: "This is a test article about something important.",
    tags: ["test", "example"],
    sourceThreadId: "thread-123",
    sourceBranchIds: ["branch-1", "branch-2"],
    relatedArticles: [],
  };

  it("creates a markdown file at the correct path", async () => {
    const filePath = await writeArticle(vaultPath, baseArticle);
    expect(filePath).toBe(join(vaultPath, "wiki", "test-article.md"));

    const content = await readFile(filePath, "utf-8");
    expect(content).toBeTruthy();
  });

  it("has correct frontmatter", async () => {
    const filePath = await writeArticle(vaultPath, baseArticle);
    const raw = await readFile(filePath, "utf-8");
    const { data } = matter(raw);

    expect(data.title).toBe("Test Article");
    expect(data.tags).toEqual(["test", "example"]);
    expect(data.source_thread).toBe("thread-123");
    expect(data.source_branches).toEqual(["branch-1", "branch-2"]);
    expect(data.created).toBeDefined();
    expect(typeof data.created).toBe("string");
  });

  it("contains wikilinks to related articles", async () => {
    const article: WikiArticle = {
      ...baseArticle,
      relatedArticles: ["related-one", "related-two"],
    };

    const filePath = await writeArticle(vaultPath, article);
    const raw = await readFile(filePath, "utf-8");

    expect(raw).toContain("[[related-one]]");
    expect(raw).toContain("[[related-two]]");
    expect(raw).toContain("## Related");
  });

  it("omits Related section when no related articles", async () => {
    const filePath = await writeArticle(vaultPath, baseArticle);
    const raw = await readFile(filePath, "utf-8");

    expect(raw).not.toContain("## Related");
  });
});
