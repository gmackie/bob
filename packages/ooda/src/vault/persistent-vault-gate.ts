import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { isAbsolute } from "node:path";
import { VersionedStorageError } from "./versioned-storage";

/** Node host only. Keep this database outside the vault on a local persistent
 * volume shared by every cooperating writer. Never copy it per process.
 * Claims have no expiry: process death must not silently restore write access.
 * Legacy writers and hosts on other machines must be fenced separately.
 */
export class PersistentVaultGate {
  private readonly db: DatabaseSync;

  constructor(path: string, readonly generation: string) {
    if (!isAbsolute(path)) throw new Error("Persistent gate requires an absolute database path");
    if (!generation.trim()) throw new Error("Vault generation is required");
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS vault_gate (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        generation TEXT NOT NULL, closed INTEGER NOT NULL DEFAULT 0,
        admission TEXT
      );
      CREATE TABLE IF NOT EXISTS vault_generations (generation TEXT PRIMARY KEY);`);
    this.db.prepare("INSERT OR IGNORE INTO vault_gate(singleton,generation) VALUES(1,?)").run(generation);
    this.db.exec("INSERT OR IGNORE INTO vault_generations SELECT generation FROM vault_gate");
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const admission = randomUUID();
    const claim = this.db.prepare(`UPDATE vault_gate SET admission=?
      WHERE singleton=1 AND generation=? AND closed=0 AND admission IS NULL`)
      .run(admission, this.generation);
    if (claim.changes !== 1) throw new VersionedStorageError("NotReady", "Vault generation is closed or requires recovery");
    try {
      return await operation();
    } finally {
      this.db.prepare("UPDATE vault_gate SET admission=NULL WHERE singleton=1 AND generation=? AND admission=?")
        .run(this.generation, admission);
    }
  }

  /** Closing is durable even when drainage times out or this process crashes. */
  async closeAndDrain(timeoutMs = 30_000): Promise<void> {
    this.db.prepare("UPDATE vault_gate SET closed=1 WHERE singleton=1 AND generation=?").run(this.generation);
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const row = this.db.prepare("SELECT generation,admission FROM vault_gate WHERE singleton=1").get();
      if (row?.generation !== this.generation || row.admission === null) return;
      if (Date.now() >= deadline) throw new VersionedStorageError("NotReady", "Vault admission remains unresolved; recovery required");
      await delay(Math.min(25, Math.max(1, deadline - Date.now())));
    }
  }

  /** Only a drained, closed generation can advance. The caller must first
   * reconcile provider outcomes and fence non-cooperating writers. No force
   * unlock is offered: an orphan claim requires an offline recovery procedure.
   */
  advance(nextGeneration: string): void {
    if (!nextGeneration.trim() || nextGeneration === this.generation) throw new Error("A fresh generation is required");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT 1 FROM vault_generations WHERE generation=?").get(nextGeneration)) {
        throw new VersionedStorageError("NotReady", "Vault generations cannot be reused");
      }
      const result = this.db.prepare(`UPDATE vault_gate SET generation=?,closed=0
      WHERE singleton=1 AND generation=? AND closed=1 AND admission IS NULL`)
      .run(nextGeneration, this.generation);
      if (result.changes !== 1) throw new VersionedStorageError("NotReady", "Vault generation has not drained");
      this.db.prepare("INSERT INTO vault_generations VALUES(?)").run(nextGeneration);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  dispose(): void { this.db.close(); }
}
