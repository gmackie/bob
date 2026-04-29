import { readdir, readFile as fsReadFile } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";

import matter from "gray-matter";

import type { VaultFile } from "./types";

/**
 * Recursively list .md files under vaultPath, returning relative paths.
 * If glob is provided, filter filenames by simple glob matching.
 */
export async function listFiles(
  vaultPath: string,
  glob?: string,
): Promise<string[]> {
  const entries = await readdir(vaultPath, { recursive: true, withFileTypes: true });

  let files = entries
    .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
    .map((entry) => {
      return relative(vaultPath, join(entry.parentPath, entry.name));
    })
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
  const fullPath = join(vaultPath, filePath);
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
