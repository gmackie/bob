import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import matter from "gray-matter";
import { Effect } from "effect";

export interface WikiArticle {
  title: string;
  slug: string;
  content: string;
  tags: string[];
  sourceThreadId: string;
  sourceBranchIds: string[];
  relatedArticles: string[];
}

export async function writeArticle(
  vaultPath: string,
  article: WikiArticle,
): Promise<string> {
  const filePath = join(vaultPath, "wiki", `${article.slug}.md`);
  await mkdir(dirname(filePath), { recursive: true });

  const frontmatter = {
    title: article.title,
    tags: article.tags,
    created: new Date().toISOString(),
    source_thread: article.sourceThreadId,
    source_branches: article.sourceBranchIds,
  };

  const wikilinks =
    article.relatedArticles.length > 0
      ? `\n\n## Related\n\n${article.relatedArticles.map((slug) => `- [[${slug}]]`).join("\n")}\n`
      : "";

  const body = `${article.content}${wikilinks}`;
  const output = matter.stringify(body, frontmatter);

  await writeFile(filePath, output, "utf-8");
  return filePath;
}

export const writeArticleEffect = (
  vaultPath: string,
  article: WikiArticle,
): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: () => writeArticle(vaultPath, article),
    catch: (err) => (err instanceof Error ? err : new Error(String(err))),
  });
