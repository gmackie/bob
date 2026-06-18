import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join } from "node:path";

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function resolveThreadPath(
  storageRoot: string,
  slug: string,
): string {
  if (!existsSync(storageRoot)) {
    throw new WorkspacePathError(
      `Storage root does not exist: "${storageRoot}"`,
    );
  }

  if (!SLUG_PATTERN.test(slug)) {
    throw new WorkspacePathError(
      `Invalid thread slug: "${slug}". Must be lowercase alphanumeric with hyphens.`,
    );
  }

  if (slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
    throw new WorkspacePathError(
      `Thread slug contains path traversal: "${slug}"`,
    );
  }

  return join(storageRoot, slug);
}

export async function validatePathUnderRoot(
  storageRoot: string,
  targetPath: string,
): Promise<void> {
  const resolvedRoot = await realpath(storageRoot);
  const resolvedTarget = await realpath(targetPath);

  if (
    !resolvedTarget.startsWith(resolvedRoot + "/") &&
    resolvedTarget !== resolvedRoot
  ) {
    throw new WorkspacePathError(
      `Path "${targetPath}" resolves outside storage root "${storageRoot}"`,
    );
  }
}
