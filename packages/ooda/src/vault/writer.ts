import { randomUUID } from "node:crypto";
import {
  writeFile as fsWriteFile,
  link,
  mkdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname } from "node:path";
import { resolveVaultPath } from "./path-boundary";

import matter from "gray-matter";

export class VaultWriterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultWriterError";
  }
}

async function validatePath(
  vaultPath: string,
  filePath: string,
): Promise<string> {
  try {
    return await resolveVaultPath(vaultPath, filePath, {
      allowMissing: true,
      preserveLeaf: true,
    });
  } catch (error) {
    throw new VaultWriterError(
      error instanceof Error ? error.message : "Invalid vault path",
    );
  }
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
  const fullPath = await validatePath(vaultPath, filePath);
  const tmpPath = `${fullPath}.tmp-${process.pid}-${randomUUID()}`;

  const output =
    frontmatter != null ? matter.stringify(content, frontmatter) : content;

  // Ensure parent directories exist
  await mkdir(dirname(fullPath), { recursive: true });

  // Atomic write: write to tmp, then rename
  try {
    await fsWriteFile(tmpPath, output, { encoding: "utf-8", flag: "wx" });
    await rename(tmpPath, fullPath);
  } finally {
    await rm(tmpPath, { force: true });
  }
}

/**
 * Delete a file from the vault.
 */
export async function deleteFile(
  vaultPath: string,
  filePath: string,
): Promise<void> {
  const fullPath = await validatePath(vaultPath, filePath);
  await rm(fullPath, { force: true });
}

/**
 * Create a generated file without ever overwriting human edits.
 */
export async function writeFileOnce(
  vaultPath: string,
  filePath: string,
  content: string,
): Promise<"created" | "unchanged"> {
  const fullPath = await validatePath(vaultPath, filePath);
  const tmpPath = `${fullPath}.tmp-${process.pid}-${randomUUID()}`;

  await mkdir(dirname(fullPath), { recursive: true });
  try {
    await fsWriteFile(tmpPath, content, { encoding: "utf-8", flag: "wx" });
    try {
      // Linking a complete temporary file is atomic and never replaces a target.
      await link(tmpPath, fullPath);
      return "created";
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }

      const existing = await readFile(fullPath, "utf-8");
      if (existing === content) return "unchanged";
      throw new VaultWriterError(
        `Refusing to overwrite existing content at "${filePath}"`,
      );
    }
  } finally {
    await rm(tmpPath, { force: true });
  }
}
