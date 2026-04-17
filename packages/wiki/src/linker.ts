import { readdir, readFile } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";

export interface WikiIndex {
  slug: string;
  title: string;
  tags: string[];
  outboundLinks: string[];
}

export async function buildIndex(vaultPath: string): Promise<WikiIndex[]> {
  const wikiDir = join(vaultPath, "wiki");
  const files = await readdir(wikiDir).catch(() => []);
  const index: WikiIndex[] = [];

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const content = await readFile(join(wikiDir, file), "utf-8");
    const { data, content: body } = matter(content);
    const links = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
    index.push({
      slug: file.replace(".md", ""),
      title: (data.title as string) ?? file.replace(".md", ""),
      tags: (data.tags as string[]) ?? [],
      outboundLinks: links,
    });
  }

  return index;
}

export function findOrphanedArticles(index: WikiIndex[]): string[] {
  const allLinkedSlugs = new Set(index.flatMap((a) => a.outboundLinks));
  return index.filter((a) => !allLinkedSlugs.has(a.slug)).map((a) => a.slug);
}
