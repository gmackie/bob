// BOB-95: the edge's record of items reaching production ("shipped today", BOB-91 wallboard).
// The ledger runs inside the ingest transaction; ShippedEdge serves opted-in sockets.
import { MAX_SHIPPED_ENTRIES, SHIPPED_WINDOW_MS, type ItemSnapshot, type PlanSnapshot, type ShippedEntry, type ShippedMessage } from "@bob/sdlc-view";
import { readAttachment, type AttachedSocket } from "./edge-sockets";
import { isViewer } from "./routes";
import type { SqlPort } from "./sql";

export const SHIPPED_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS sdlc_shipped (item_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, issue TEXT, repository TEXT, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS sdlc_shipped_by_age ON sdlc_shipped (at)",
];

const SHIPPED_MILESTONE = "production-verified";
const verified = (item: ItemSnapshot | undefined) => item?.achievedMilestones.includes(SHIPPED_MILESTONE) ?? false;

/**
 * One row per item, written the first time the edge sees it gain production-verified. An
 * item already verified when the edge first held it (a fresh edge's baseline snapshot, or
 * an item stored before this feature) is not recorded: the edge does not know when it shipped.
 * Rows outlive the item's plan, and are pruned to SHIPPED_WINDOW_MS and MAX_SHIPPED_ENTRIES.
 */
export class ShippedLedger {
  constructor(private readonly sql: SqlPort) {}

  /**
   * Call inside the apply transaction, after the batch is written. `applied`: items that
   * took effect; `previous`: those items as stored before the batch; `plan` reads the
   * plan as it now stands, for the issue identifier and repository.
   */
  observe(
    applied: readonly ItemSnapshot[],
    previous: ReadonlyMap<string, ItemSnapshot>,
    baseline: boolean,
    plan: (planId: string) => PlanSnapshot | undefined,
    now: number,
  ): ShippedEntry[] {
    if (baseline) return [];
    const added: ShippedEntry[] = [];
    for (const item of applied) {
      if (!verified(item) || verified(previous.get(item.itemId))) continue;
      const def = plan(item.planId)?.definition.items.find((d) => d.itemId === item.itemId);
      const entry: ShippedEntry = {
        itemId: item.itemId,
        planId: item.planId,
        issue: def?.issue.identifier?.slice(0, 200) ?? null,
        repository: (item.execution?.target.repository.repositoryId ?? def?.target.repository.repositoryId)?.slice(0, 200) ?? null,
        at: now,
      };
      const inserted = this.sql.exec<{ item_id: string }>(
        "INSERT INTO sdlc_shipped (item_id, plan_id, issue, repository, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (item_id) DO NOTHING RETURNING item_id",
        entry.itemId, entry.planId, entry.issue, entry.repository, entry.at,
      );
      if (inserted.length > 0) added.push(entry);
    }
    if (added.length > 0) this.prune(now);
    return added;
  }

  /** Drops entries older than SHIPPED_WINDOW_MS, then the oldest past MAX_SHIPPED_ENTRIES. */
  prune(now: number): void {
    this.sql.exec("DELETE FROM sdlc_shipped WHERE at < ?", now - SHIPPED_WINDOW_MS);
    this.sql.exec(
      "DELETE FROM sdlc_shipped WHERE item_id IN (SELECT item_id FROM sdlc_shipped ORDER BY at DESC, item_id LIMIT -1 OFFSET ?)",
      MAX_SHIPPED_ENTRIES,
    );
  }

  /** Entries within the window, newest first. */
  recent(now: number): ShippedEntry[] {
    return this.sql
      .exec<{ item_id: string; plan_id: string; issue: string | null; repository: string | null; at: number }>(
        "SELECT item_id, plan_id, issue, repository, at FROM sdlc_shipped WHERE at >= ? ORDER BY at DESC, item_id LIMIT ?",
        now - SHIPPED_WINDOW_MS, MAX_SHIPPED_ENTRIES,
      )
      .map((r) => ({ itemId: r.item_id, planId: r.plan_id, issue: r.issue, repository: r.repository, at: Number(r.at) }));
  }
}

/** A shipped request is `{"type":"shipped"}`; anything longer is ignored unread. */
export const MAX_SHIPPED_REQUEST_CHARS = 64;

export function parseShippedRequest(message: string | ArrayBuffer): boolean {
  if (typeof message !== "string" || message.length > MAX_SHIPPED_REQUEST_CHARS) return false;
  try {
    const value = JSON.parse(message) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) && (value as { type?: unknown }).type === "shipped";
  } catch {
    return false;
  }
}

export interface ShippedEdgeOptions {
  sockets: () => AttachedSocket[];
  recent: (now: number) => ShippedEntry[];
  /** SDLC_VIEWER_USER_IDS as it is now; re-read on every request and fan-out. */
  viewerIds: () => string | undefined;
  now?: () => number;
}

const send = (socket: AttachedSocket, message: ShippedMessage) => {
  try { socket.send(JSON.stringify(message)); } catch { /* closed */ }
};

/** Opt-in delivery of shipped entries to viewer sockets; the opt-in lives in the hibernation-safe attachment. */
export class ShippedEdge {
  private readonly now: () => number;
  constructor(private readonly options: ShippedEdgeOptions) {
    this.now = options.now ?? Date.now;
  }

  private allowed(socket: AttachedSocket): boolean {
    const { greeted, userId } = readAttachment(socket);
    return greeted === true && typeof userId === "string" && userId.length > 0 && isViewer(userId, this.options.viewerIds());
  }

  /** A ShippedRequest: ignored unless the socket may watch; otherwise opts in and replies with the full list. */
  request(socket: AttachedSocket): boolean {
    if (!this.allowed(socket)) return false;
    socket.serializeAttachment({ ...readAttachment(socket), shipped: true });
    send(socket, { type: "shipped", replace: true, entries: this.options.recent(this.now()) });
    return true;
  }

  /** Newly recorded entries, after the ingest committed, to every opted-in viewer socket. */
  publish(entries: ShippedEntry[]): void {
    if (entries.length === 0) return;
    const message: ShippedMessage = { type: "shipped", replace: false, entries };
    for (const socket of this.options.sockets()) {
      if (readAttachment(socket).shipped === true && this.allowed(socket)) send(socket, message);
    }
  }
}
