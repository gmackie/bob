import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

import { resolveThreadPath } from "@gmacko/ooda/thread-model";

export interface CreateWorkspaceInput {
  storageRoot: string;
  slug: string;
  title: string;
  domainPackId?: string;
}

export interface CreateWorkspaceResult {
  threadDir: string;
}

const SUBDIRS = [
  "notes",
  "hypotheses",
  "actions",
  "reflections",
  "artifacts",
  "sources",
  "sessions/summaries",
];

export async function createThreadWorkspace(
  input: CreateWorkspaceInput,
): Promise<CreateWorkspaceResult> {
  const threadDir = resolveThreadPath(input.storageRoot, input.slug);

  if (existsSync(threadDir)) {
    throw new Error(`Thread workspace already exists: ${threadDir}`);
  }

  // Create directory structure
  mkdirSync(threadDir, { recursive: true });
  for (const subdir of SUBDIRS) {
    mkdirSync(`${threadDir}/${subdir}`, { recursive: true });
  }

  // Write thread.json
  const metadata = {
    title: input.title,
    slug: input.slug,
    domainPackId: input.domainPackId ?? null,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(
    `${threadDir}/thread.json`,
    JSON.stringify(metadata, null, 2),
  );

  // Commit to vault-level repo
  execSync(`git add -- "${input.slug}"`, {
    cwd: input.storageRoot,
    stdio: "pipe",
  });
  execSync(
    `git -c user.name="OODA" -c user.email="ooda@local" commit -m "Create thread: ${input.slug}"`,
    { cwd: input.storageRoot, stdio: "pipe" },
  );

  return { threadDir };
}
