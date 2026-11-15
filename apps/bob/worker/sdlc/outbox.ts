import { COMMAND_LIMITS, type CommandInput, type CommandResult, type QueuedCommand } from "@bob/sdlc-view";
import type { SqlPort } from "./sql";

/** Created by EdgeStore's schema init, in the same transaction as the state tables. */
export const OUTBOX_SCHEMA = [
  // delivered_at: when the command last went out in an ingest response (null: never).
  "CREATE TABLE IF NOT EXISTS command_outbox (command_id TEXT PRIMARY KEY, actor TEXT NOT NULL, queued_at INTEGER NOT NULL, delivered_at INTEGER, json TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS command_outbox_by_age ON command_outbox (queued_at)",
  // synthetic = 1: an expiry the edge wrote itself; a real result may still replace it.
  "CREATE TABLE IF NOT EXISTS command_results (command_id TEXT PRIMARY KEY, at INTEGER NOT NULL, synthetic INTEGER NOT NULL, json TEXT NOT NULL)",
];

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
  size(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM command_outbox")[0]?.n ?? 0;
  }

  /** Inserts once per commandId; a repeat is a no-op. */
  enqueue(command: QueuedCommand): void {
    const { commandId, actor, queuedAt, ...input } = command;
    this.sql.exec(
      "INSERT INTO command_outbox (command_id, actor, queued_at, delivered_at, json) VALUES (?, ?, ?, NULL, ?) ON CONFLICT (command_id) DO NOTHING",
      commandId, actor, queuedAt, JSON.stringify(input),
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

  private store(result: CommandResult, now: number, synthetic: boolean) {
    this.sql.exec(
      "INSERT INTO command_results (command_id, at, synthetic, json) VALUES (?, ?, ?, ?) ON CONFLICT (command_id) DO UPDATE SET at = excluded.at, synthetic = excluded.synthetic, json = excluded.json",
      result.commandId, now, synthetic ? 1 : 0, JSON.stringify(result),
    );
  }
}
