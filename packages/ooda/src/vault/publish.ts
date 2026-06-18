import { writeFile } from "./writer";
import { commitAndPush } from "./git";

export interface PublishOptions {
  title: string;
  content: string;
  site: "gmacko" | "grahammackie" | "gmac";
  tags?: string[];
  date?: string; // ISO date, defaults to today
}

/**
 * Slugify a title: lowercase, replace spaces with hyphens,
 * strip non-alphanumeric except hyphens.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Write a Jekyll draft with front matter into {websitePath}/_drafts/,
 * commit, and push.
 *
 * @returns The relative file path written (e.g. `_drafts/my-post.md`)
 */
export async function publishDraft(
  websitePath: string,
  opts: PublishOptions,
): Promise<string> {
  const slug = slugify(opts.title);
  if (slug.length === 0) {
    throw new Error("Title produces an empty slug");
  }

  const filePath = `_drafts/${slug}.md`;
  const date = opts.date ?? new Date().toISOString().slice(0, 10);

  const frontmatter: Record<string, unknown> = {
    title: opts.title,
    site: opts.site,
    date,
    layout: "post",
  };

  if (opts.tags && opts.tags.length > 0) {
    frontmatter.tags = opts.tags;
  }

  await writeFile(websitePath, filePath, opts.content, frontmatter);
  await commitAndPush(websitePath, `draft: ${opts.title} (${opts.site})`);

  return filePath;
}
