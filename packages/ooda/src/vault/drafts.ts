import { mkdir, readdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";

import matter from "gray-matter";

/**
 * Metadata stored in the frontmatter of a draft markdown file.
 *
 * Drafts are PR-style pending changes against a KB. They live under
 * `drafts/<kb_slug>/<id>.md` inside the vault, separate from the KB's
 * final `kbs/<slug>/` location. The KB compile pipeline ignores anything
 * under `drafts/` — these files are human-review material, not published
 * content.
 *
 * Approval (a future task) moves the file from `drafts/` to the real KB
 * location, at which point the status transitions to `approved`.
 */
export interface DraftMetadata {
  kbSlug: string;
  sourceIds: number[];
  createdByThreadId?: string;
  createdAt: string; // ISO 8601
  status: "pending" | "approved" | "rejected";
}

export interface Draft extends DraftMetadata {
  id: string; // uuid
  relativePath: string; // drafts/<kbSlug>/<id>.md
  body: string; // note markdown (no frontmatter)
}

/**
 * Input to `writeDraft` — the caller provides the permanent fields; we
 * stamp `createdAt` + `status=pending` on disk.
 */
export type NewDraftMetadata = Omit<DraftMetadata, "createdAt" | "status">;

function draftsRoot(vaultPath: string): string {
  return join(vaultPath, "drafts");
}

/**
 * Write a new draft markdown file under
 * `<vaultPath>/drafts/<kbSlug>/<uuid>.md` with frontmatter describing the
 * pending change. Never commits — the file lives in-tree for reviewers
 * to approve from the dashboard.
 *
 * Returns the parsed `Draft` representation (id + relative path + fields
 * written to disk).
 */
export async function writeDraft(
  vaultPath: string,
  meta: NewDraftMetadata,
  body: string,
): Promise<Draft> {
  const id = randomUUID();
  const relativePath = `drafts/${meta.kbSlug}/${id}.md`;
  const absPath = join(vaultPath, relativePath);

  // Defense-in-depth against path traversal: if kbSlug contains "../" or
  // absolute-path components, resolve() will escape draftsRoot. The tRPC
  // layer enforces a strict regex, but this check prevents any future
  // caller (tests, other packages) from bypassing it.
  const resolvedAbs = resolve(absPath);
  const resolvedRoot = resolve(draftsRoot(vaultPath)) + sep;
  if (!resolvedAbs.startsWith(resolvedRoot)) {
    throw new Error(`writeDraft: kbSlug escapes drafts root: ${meta.kbSlug}`);
  }

  await mkdir(dirname(absPath), { recursive: true });

  const frontmatter: DraftMetadata = {
    kbSlug: meta.kbSlug,
    sourceIds: meta.sourceIds,
    ...(meta.createdByThreadId !== undefined
      ? { createdByThreadId: meta.createdByThreadId }
      : {}),
    createdAt: new Date().toISOString(),
    status: "pending",
  };

  const content = matter.stringify(body, frontmatter as unknown as Record<string, unknown>);
  await fsWriteFile(absPath, content, "utf-8");

  return {
    id,
    relativePath,
    body,
    ...frontmatter,
  };
}

/**
 * List every draft in the vault, optionally scoped to a specific KB slug.
 *
 * Each returned draft carries its frontmatter plus the parsed body. The
 * `id` is derived from the filename stem.
 *
 * If the drafts directory does not exist (no drafts have been written
 * yet), returns an empty array rather than throwing.
 */
export async function listDrafts(
  vaultPath: string,
  kbSlug?: string,
): Promise<Draft[]> {
  const rootDir = kbSlug
    ? join(draftsRoot(vaultPath), kbSlug)
    : draftsRoot(vaultPath);

  let entries: Dirent[];
  try {
    entries = (await readdir(rootDir, {
      recursive: true,
      withFileTypes: true,
    })) as Dirent[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const drafts: Draft[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    const absPath = join(entry.parentPath, entry.name);
    // The stored `relativePath` is always rooted at `drafts/` inside the
    // vault, regardless of whether we scoped the listing to a single KB.
    const relativePath = relative(vaultPath, absPath).split(sep).join("/");

    const raw = await fsReadFile(absPath, "utf-8");
    const parsed = matter(raw);
    const data = parsed.data as Partial<DraftMetadata>;

    // Skip files whose frontmatter doesn't look like a draft — e.g. a
    // stray markdown file that someone hand-dropped under drafts/. We
    // don't throw, just ignore.
    if (
      typeof data.kbSlug !== "string" ||
      !Array.isArray(data.sourceIds) ||
      typeof data.createdAt !== "string" ||
      (data.status !== "pending" &&
        data.status !== "approved" &&
        data.status !== "rejected")
    ) {
      continue;
    }

    const id = entry.name.replace(/\.md$/, "");
    drafts.push({
      id,
      relativePath,
      body: parsed.content,
      kbSlug: data.kbSlug,
      sourceIds: data.sourceIds,
      ...(typeof data.createdByThreadId === "string"
        ? { createdByThreadId: data.createdByThreadId }
        : {}),
      createdAt: data.createdAt,
      status: data.status,
    });
  }

  // Stable ordering: newest first (ISO timestamps sort lexicographically).
  drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return drafts;
}
