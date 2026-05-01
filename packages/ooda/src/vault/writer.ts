import { mkdir, rename, rm, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";

import matter from "gray-matter";

export class VaultWriterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultWriterError";
  }
}

/**
 * Validate that filePath does not escape vaultPath via traversal.
 * Rejects paths containing ".." or that resolve outside the vault root.
 */
function validatePath(vaultPath: string, filePath: string): string {
  if (filePath.includes("..")) {
    throw new VaultWriterError(
      `Path traversal detected: "${filePath}" contains ".."`,
    );
  }

  const resolved = resolve(vaultPath, filePath);
  const normalizedVault = normalize(vaultPath);

  if (!resolved.startsWith(normalizedVault + "/") && resolved !== normalizedVault) {
    throw new VaultWriterError(
      `Path "${filePath}" resolves outside vault root "${vaultPath}"`,
    );
  }

  return resolved;
}

/**
 * Write a file atomically using temp-file-rename.
 * If frontmatter is provided, prepends a YAML frontmatter block.
 * Creates parent directories if needed.
 */
export async function writeFile(
  vaultPath: string,
  filePath: string,
  content: string,
  frontmatter?: Record<string, unknown>,
): Promise<void> {
  const fullPath = validatePath(vaultPath, filePath);
  const tmpPath = fullPath + ".tmp";

  const output =
    frontmatter != null
      ? matter.stringify(content, frontmatter)
      : content;

  // Ensure parent directories exist
  await mkdir(dirname(fullPath), { recursive: true });

  // Atomic write: write to tmp, then rename
  await fsWriteFile(tmpPath, output, "utf-8");
  await rename(tmpPath, fullPath);
}

/**
 * Delete a file from the vault.
 */
export async function deleteFile(
  vaultPath: string,
  filePath: string,
): Promise<void> {
  const fullPath = validatePath(vaultPath, filePath);
  await rm(fullPath, { force: true });
}
