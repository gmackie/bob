import { randomUUID } from "node:crypto";
import {
  writeFile as fsWriteFile,
  link,
  lstat,
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

/** Resolve a path that must currently be a regular file (not a link or directory). */
async function existingFile(vaultPath: string, filePath: string): Promise<string> {
  const fullPath = await validatePath(vaultPath, filePath);
  const info = await lstat(fullPath).catch(() => null);
  if (!info?.isFile()) throw new VaultWriterError(`Not a vault file: ${filePath}`);
  return fullPath;
}

/** Delete an existing regular file; a missing path is an error, not a no-op. */
export async function removeFile(vaultPath: string, filePath: string): Promise<void> {
  await rm(await existingFile(vaultPath, filePath));
}

/** Move a regular file without ever replacing an existing destination. */
export async function moveFile(vaultPath: string, from: string, to: string): Promise<void> {
  const source = await existingFile(vaultPath, from);
  const target = await validatePath(vaultPath, to);
  if (source === target) throw new VaultWriterError("Move source and destination are the same");
  await mkdir(dirname(target), { recursive: true });
  try {
    // link() fails with EEXIST instead of clobbering, unlike rename().
    await link(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new VaultWriterError(`Destination already exists: ${to}`);
    }
    throw error;
  }
  await rm(source);
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
