import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import simpleGit from "simple-git";

import type { PublicationRecord } from "./versioned-storage";

const OPERATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function assertOperationId(operationId: string): void {
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new Error(
      `Invalid operationId ${JSON.stringify(operationId)}: must match ${OPERATION_ID_PATTERN}`,
    );
  }
}

export async function resolveGitDir(repoPath: string): Promise<string> {
  const out = await simpleGit(repoPath).revparse(["--git-dir"]);
  return resolve(repoPath, out.trim());
}

/**
 * Durable, clone-local store of publication intents and their outcomes.
 *
 * Records live under `<git-dir>/ooda/publications/` so they are never
 * committed into the vault and never pushed; a pending publication is a fact
 * about this clone, not about the shared history. Writes are atomic
 * (temp file + rename) so a crash cannot leave a half-written record.
 */
export class PublicationJournal {
  constructor(readonly dir: string) {}

  static async forRepo(repoPath: string): Promise<PublicationJournal> {
    const gitDir = await resolveGitDir(repoPath);
    return new PublicationJournal(join(gitDir, "ooda", "publications"));
  }

  private file(operationId: string): string {
    assertOperationId(operationId);
    return join(this.dir, `${operationId}.json`);
  }

  async read(operationId: string): Promise<PublicationRecord | null> {
    try {
      const raw = await readFile(this.file(operationId), "utf-8");
      return JSON.parse(raw) as PublicationRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async write(record: PublicationRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.file(record.intent.operationId);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(record, null, 2), "utf-8");
    await rename(tmp, target);
  }

  /** All records, oldest intent first (then by operationId for stability). */
  async list(): Promise<PublicationRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const records: PublicationRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const raw = await readFile(join(this.dir, name), "utf-8");
      records.push(JSON.parse(raw) as PublicationRecord);
    }

    records.sort((a, b) => {
      const byTime = a.intent.createdAt.localeCompare(b.intent.createdAt);
      return byTime !== 0
        ? byTime
        : a.intent.operationId.localeCompare(b.intent.operationId);
    });
    return records;
  }
}
