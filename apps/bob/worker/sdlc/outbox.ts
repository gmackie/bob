import { createHash } from "node:crypto";
import { COMMAND_LIMITS, commandFingerprint, type CommandInput, type CommandResult, type QueuedCommand } from "@bob/sdlc-view";
import type { SqlPort } from "./sql";

/** Created by EdgeStore's schema init, in the same transaction as the state tables. */
export const OUTBOX_SCHEMA = [
  // delivered_at: when the command last went out in an ingest response (null: never).
  // input_hash: commandHash() of what was queued; null only on rows from before it existed.
  "CREATE TABLE IF NOT EXISTS command_outbox (command_id TEXT PRIMARY KEY, actor TEXT NOT NULL, queued_at INTEGER NOT NULL, delivered_at INTEGER, json TEXT NOT NULL, input_hash TEXT)",
  "CREATE INDEX IF NOT EXISTS command_outbox_by_age ON command_outbox (queued_at)",
  "CREATE INDEX IF NOT EXISTS command_outbox_by_actor ON command_outbox (actor)",
  // synthetic = 1: an expiry the edge wrote itself; a real result may still replace it.
  "CREATE TABLE IF NOT EXISTS command_results (command_id TEXT PRIMARY KEY, at INTEGER NOT NULL, synthetic INTEGER NOT NULL, json TEXT NOT NULL, input_hash TEXT)",
  // One row per command a user sent in the last minute, across all of their sockets.
  "CREATE TABLE IF NOT EXISTS command_rate (user_id TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS command_rate_by_user ON command_rate (user_id, at)",
];

/**
 * Columns added after the first release of the tables: a DO whose tables were created by
 * the earlier code gets them by ALTER TABLE (CREATE TABLE IF NOT EXISTS leaves it as it was).
 * Runs after OUTBOX_SCHEMA, in the same transaction.
 */
export function migrateOutbox(sql: SqlPort): void {
  for (const table of ["command_outbox", "command_results"]) {
    const columns = sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);
    if (!columns.includes("input_hash")) sql.exec(`ALTER TABLE ${table} ADD COLUMN input_hash TEXT`);
  }
}

/** SHA-256 (hex) of commandFingerprint: operation + input as stable JSON, no commandId or confirm. */
export const commandHash = (command: CommandInput) => createHash("sha256").update(commandFingerprint(command)).digest("hex");

/** Sliding window for the per-user command rate. */
const RATE_WINDOW_MS = 60_000;

/** Results are kept this long so a client re-sending a commandId gets the answer again. */
export const RESULT_RETENTION_MS = 60 * 60_000;
/**
 * A command handed to the exporter is not handed out again for this long, so it goes out
 * once per pending period; without a result by then it is re-sent (at-least-once).
 */
export const REDELIVER_AFTER_MS = 10_000;
/** At most this many commands in one ingest response. */
export const MAX_COMMANDS_PER_RESPONSE = 20;

export interface Exchange {
  /** Results that took effect (real or expiry), to broadcast after the commit. */
  finished: CommandResult[];
  /** What this ingest response carries for the exporter. */
  commands: QueuedCommand[];
  /** Commands still queued after the exchange. */
  pending: number;
}

/**
 * The DO's command outbox and recent results, as SQLite rows. Every method that writes
 * runs in one transaction; callers broadcast what it returns only after it returns.
 */
export class CommandOutbox {
  constructor(private readonly sql: SqlPort) {}

  result(commandId: string): CommandResult | undefined {
    const row = this.sql.exec<{ json: string }>("SELECT json FROM command_results WHERE command_id = ?", commandId)[0];
    return row ? (JSON.parse(row.json) as CommandResult) : undefined;
  }
  isQueued(commandId: string): boolean {
    return this.sql.exec("SELECT 1 FROM command_outbox WHERE command_id = ?", commandId).length > 0;
  }
  /**
   * What the edge knows of a commandId: its stored result, or that it is queued, with the
   * commandHash it was queued with (null on rows from before hashes were stored).
   */
  known(commandId: string): { result: CommandResult; hash: string | null } | { result: null; hash: string | null } | undefined {
    const done = this.sql.exec<{ json: string; input_hash: string | null }>("SELECT json, input_hash FROM command_results WHERE command_id = ?", commandId)[0];
    if (done) return { result: JSON.parse(done.json) as CommandResult, hash: done.input_hash };
    const queued = this.sql.exec<{ input_hash: string | null }>("SELECT input_hash FROM command_outbox WHERE command_id = ?", commandId)[0];
    return queued ? { result: null, hash: queued.input_hash } : undefined;
  }
  size(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM command_outbox")[0]?.n ?? 0;
  }
  sizeFor(actor: string): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM command_outbox WHERE actor = ?", actor)[0]?.n ?? 0;
  }
  /** Whether a result (real or expiry) arrived at or after `since`. */
  answeredSince(since: number): boolean {
    return this.sql.exec("SELECT 1 FROM command_results WHERE at >= ? LIMIT 1", since).length > 0;
  }

  /**
   * Counts one command against the user's sliding one-minute window, across all of their
   * sockets; false (nothing counted) when the window already holds `limit`. Kept in SQLite
   * so neither hibernation nor eviction resets it.
   */
  take(userId: string, now: number, limit: number = COMMAND_LIMITS.maxPerUserPerMinute): boolean {
    return this.sql.transaction(() => {
      this.sql.exec("DELETE FROM command_rate WHERE at <= ?", now - RATE_WINDOW_MS);
      const n = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM command_rate WHERE user_id = ?", userId)[0]?.n ?? 0;
      if (n >= limit) return false;
      this.sql.exec("INSERT INTO command_rate (user_id, at) VALUES (?, ?)", userId, now);
      return true;
    });
  }

  /** Inserts once per commandId; a repeat is a no-op. */
  enqueue(command: QueuedCommand): void {
    const { commandId, actor, queuedAt, ...input } = command;
    this.sql.exec(
      "INSERT INTO command_outbox (command_id, actor, queued_at, delivered_at, json, input_hash) VALUES (?, ?, ?, NULL, ?, ?) ON CONFLICT (command_id) DO NOTHING",
      commandId, actor, queuedAt, JSON.stringify(input), commandHash(input),
    );
  }

  /** Moves every command older than COMMAND_LIMITS.expireAfterMs to a synthetic failed result. */
  expire(now: number): CommandResult[] {
    return this.sql.transaction(() => this.expireIn(now));
  }

  /**
   * One ingest's worth: apply the exporter's results (for queued commands, or ones the
   * edge expired itself), expire stale commands, prune old results, and pick what the
   * response carries: queued commands not handed out within REDELIVER_AFTER_MS, oldest first.
   */
  exchange(results: CommandResult[], now: number): Exchange {
    return this.sql.transaction(() => {
      const finished: CommandResult[] = [];
      for (const result of results) {
        const queued = this.isQueued(result.commandId);
        const expired = !queued && this.sql.exec("SELECT 1 FROM command_results WHERE command_id = ? AND synthetic = 1", result.commandId).length > 0;
        if (!queued && !expired) continue; // unknown, or already answered
        this.store(result, now, false);
        this.sql.exec("DELETE FROM command_outbox WHERE command_id = ?", result.commandId);
        finished.push(result);
      }
      finished.push(...this.expireIn(now));
      // Checked first so an idle heartbeat stays read-only.
      const cutoff = now - RESULT_RETENTION_MS;
      if (this.sql.exec("SELECT 1 FROM command_results WHERE at < ? LIMIT 1", cutoff).length > 0) this.sql.exec("DELETE FROM command_results WHERE at < ?", cutoff);
      const rows = this.sql.exec<{ command_id: string; actor: string; queued_at: number; json: string }>(
        "SELECT command_id, actor, queued_at, json FROM command_outbox WHERE delivered_at IS NULL OR delivered_at <= ? ORDER BY queued_at, rowid LIMIT ?",
        now - REDELIVER_AFTER_MS, MAX_COMMANDS_PER_RESPONSE,
      );
      for (const row of rows) this.sql.exec("UPDATE command_outbox SET delivered_at = ? WHERE command_id = ?", now, row.command_id);
      const commands = rows.map((row) => ({ commandId: row.command_id, actor: row.actor, queuedAt: row.queued_at, ...(JSON.parse(row.json) as CommandInput) }));
      return { finished, commands, pending: this.size() };
    });
  }

  private expireIn(now: number): CommandResult[] {
    const stale = this.sql.exec<{ command_id: string }>("SELECT command_id FROM command_outbox WHERE queued_at <= ? ORDER BY queued_at, rowid", now - COMMAND_LIMITS.expireAfterMs);
    return stale.map(({ command_id: commandId }) => {
      const result: CommandResult = {
        commandId, ok: false,
        error: { code: "expired", message: "The coordinator did not run the command in time.", retryable: true },
      };
      this.store(result, now, true);
      this.sql.exec("DELETE FROM command_outbox WHERE command_id = ?", commandId);
      return result;
    });
  }

  /**
   * The hash comes from the queued row; a real result replacing an expiry keeps the hash
   * the expiry already carries, so call this before deleting the outbox row.
   */
  private store(result: CommandResult, now: number, synthetic: boolean) {
    const queued = this.sql.exec<{ input_hash: string | null }>("SELECT input_hash FROM command_outbox WHERE command_id = ?", result.commandId)[0];
    this.sql.exec(
      "INSERT INTO command_results (command_id, at, synthetic, json, input_hash) VALUES (?, ?, ?, ?, ?) ON CONFLICT (command_id) DO UPDATE SET at = excluded.at, synthetic = excluded.synthetic, json = excluded.json, input_hash = COALESCE(command_results.input_hash, excluded.input_hash)",
      result.commandId, now, synthetic ? 1 : 0, JSON.stringify(result), queued?.input_hash ?? null,
    );
  }
}
