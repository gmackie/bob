import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

/**
 * Resolve existing components against an owned vault root, refusing external
 * and Git-metadata aliases. The host must exclude concurrent untrusted changes
 * to the directory tree; these checks are not an openat-style race boundary.
 */
export async function resolveVaultPath(
  vaultPath: string,
  filePath: string,
  options: { allowMissing?: boolean; preserveLeaf?: boolean } = {},
): Promise<string> {
  const parts = filePath.split("/");
  if (
    !filePath ||
    isAbsolute(filePath) ||
    /[\\\x00-\x1f\x7f]/.test(filePath) ||
    filePath.includes("..") ||
    parts.some((part) => !part || part === "." || part.toLowerCase() === ".git")
  ) {
    throw new Error("Path traversal detected or protected vault path");
  }
  const root = await realpath(vaultPath);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    const candidate = join(current, parts[i]!);
    try {
      await lstat(candidate);
    } catch (error) {
      if (
        options.allowMissing &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return join(candidate, ...parts.slice(i + 1));
      }
      throw error;
    }
    // A dangling symlink is rejected even for writes: it is not a missing entry.
    const resolved = await realpath(candidate);
    const inside = relative(root, resolved);
    if (
      !inside ||
      isAbsolute(inside) ||
      inside === ".." ||
      inside.startsWith(".." + sep) ||
      inside.split(sep).some((part) => part.toLowerCase() === ".git")
    ) {
      throw new Error("Path traversal detected through a vault alias");
    }
    if (options.preserveLeaf && i === parts.length - 1) return candidate;
    current = resolved;
  }
  return current;
}
