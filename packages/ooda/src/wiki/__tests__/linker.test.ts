import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildIndex, findOrphanedArticles } from "../linker";
import { writeFile, rm, mkdtemp, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import matter from "gray-matter";

describe("buildIndex", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "wiki-linker-test-"));
    await mkdir(join(vaultPath, "wiki"), { recursive: true });
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  async function writeWikiFile(slug: string, title: string, tags: string[], body: string) {
    const frontmatter = { title, tags };
    const output = matter.stringify(body, frontmatter);
    await writeFile(join(vaultPath, "wiki", `${slug}.md`), output, "utf-8");
  }

  it("reads wiki directory and returns articles with metadata", async () => {
    await writeWikiFile("alpha", "Alpha Article", ["tag1"], "Some content.");
    await writeWikiFile("beta", "Beta Article", ["tag2", "tag3"], "More content.");

    const index = await buildIndex(vaultPath);
    expect(index).toHaveLength(2);

    const alpha = index.find(a => a.slug === "alpha");
    expect(alpha).toBeDefined();
    expect(alpha!.title).toBe("Alpha Article");
    expect(alpha!.tags).toEqual(["tag1"]);

    const beta = index.find(a => a.slug === "beta");
    expect(beta).toBeDefined();
    expect(beta!.tags).toEqual(["tag2", "tag3"]);
  });

  it("extracts [[wikilinks]] from content", async () => {
    await writeWikiFile("hub", "Hub", [], "Links to [[alpha]] and [[beta]] here.");

    const index = await buildIndex(vaultPath);
    const hub = index.find(a => a.slug === "hub");
    expect(hub!.outboundLinks).toEqual(["alpha", "beta"]);
  });

  it("returns empty array when wiki directory does not exist", async () => {
    await rm(join(vaultPath, "wiki"), { recursive: true, force: true });
    const index = await buildIndex(vaultPath);
    expect(index).toEqual([]);
  });
});

describe("findOrphanedArticles", () => {
  it("identifies articles with no inbound links", () => {
    const index = [
      { slug: "hub", title: "Hub", tags: [], outboundLinks: ["alpha", "beta"] },
      { slug: "alpha", title: "Alpha", tags: [], outboundLinks: [] },
      { slug: "beta", title: "Beta", tags: [], outboundLinks: ["alpha"] },
      { slug: "orphan", title: "Orphan", tags: [], outboundLinks: [] },
    ];

    const orphans = findOrphanedArticles(index);
    // "hub" links to alpha and beta; "beta" links to alpha
    // So alpha and beta have inbound links, but hub and orphan do not
    expect(orphans).toContain("hub");
    expect(orphans).toContain("orphan");
    expect(orphans).not.toContain("alpha");
    expect(orphans).not.toContain("beta");
  });
});
