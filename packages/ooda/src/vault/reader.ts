import { readdir, readFile as fsReadFile } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";

import matter from "gray-matter";

import { resolveVaultPath } from "./path-boundary";

import type { VaultFile } from "./types";

/**
 * Walk the vault without following symlinks. (Node 26's recursive `readdir`
 * descends into symlinked directories, which would list files outside the
 * vault boundary.) `.git` directories are skipped.
 */
async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() === ".git") continue;
      found.push(...(await walkMarkdownFiles(path)));
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      found.push(path);
    }
  }
  return found;
}

/**
 * Recursively list .md files under vaultPath, returning relative paths.
 * If glob is provided, filter filenames by simple glob matching.
 */
export async function listFiles(
  vaultPath: string,
  glob?: string,
): Promise<string[]> {
  let files = (await walkMarkdownFiles(vaultPath))
    .map((path) => relative(vaultPath, path))
    .filter(
      (path) => !path.split("/").some((part) => part.toLowerCase() === ".git"),
    )
    .sort();

  if (glob) {
    const pattern = globToRegex(glob);
    files = files.filter((f) => pattern.test(f));
  }

  return files;
}

/**
 * Read a file from the vault and parse YAML frontmatter.
 */
export async function readFile(
  vaultPath: string,
  filePath: string,
): Promise<VaultFile> {
  const fullPath = await resolveVaultPath(vaultPath, filePath);
  const raw = await fsReadFile(fullPath, "utf-8");
  const parsed = matter(raw);

  const frontmatter =
    parsed.data && Object.keys(parsed.data).length > 0
      ? (parsed.data as Record<string, unknown>)
      : null;

  return {
    relativePath: filePath,
    name: basename(filePath, ".md"),
    content: parsed.content,
    frontmatter,
  };
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports * (any chars except /) and ** (any chars including /).
 */
function globToRegex(glob: string): RegExp {
  let pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<GLOBSTAR>>/g, ".*");

  // If the pattern doesn't start with a wildcard, anchor it
  if (!glob.startsWith("*")) {
    pattern = "(?:^|/)" + pattern;
  }

  return new RegExp(pattern);
}
