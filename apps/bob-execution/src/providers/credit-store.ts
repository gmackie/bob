/**
 * Durable backing for the credit latch.
 *
 * Two reasons this is on disk rather than in memory:
 *
 * 1. `bob-execution.service` runs Restart=always/RestartSec=10. An in-memory
 *    latch would report `ready` ten seconds after any crash, and the runner
 *    would resume burning the backlog against an account with no balance.
 * 2. The task runner and the daemon are separate processes that both dispatch
 *    agents. Sharing one file is what stops them holding different opinions
 *    about the same provider.
 *
 * Every operation is best-effort: a missing, corrupt, or unwritable state file
 * degrades to "no latch known" and must never take a daemon down on boot.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CreditRecord {
  detail: string;
  at: string;
}

export type CreditStateFile = Record<string, CreditRecord>;

export interface CreditStore {
  read(): CreditStateFile;
  write(state: CreditStateFile): void;
}

/**
 * Default location. Overridable so the runner, the daemon, and tests can be
 * pointed at the same file (or at separate ones) explicitly.
 */
export function defaultCreditStatePath(): string {
  return (
    process.env.BOB_CREDIT_STATE_PATH ??
    join(process.env.BOB_STATE_DIR ?? join(homedir(), ".bob"), "credit-state.json")
  );
}

export class FileCreditStore implements CreditStore {
  constructor(private readonly path: string = defaultCreditStatePath()) {}

  read(): CreditStateFile {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed as CreditStateFile;
    } catch {
      return {};
    }
  }

  write(state: CreditStateFile): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      writeFileSync(this.path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      // writeFileSync only applies `mode` when creating the file; an existing
      // file keeps its original permissions, so set them explicitly.
      chmodSync(this.path, 0o600);
    } catch {
      // Best-effort. Losing durability is survivable; crashing the daemon on a
      // read-only filesystem is not.
    }
  }
}
