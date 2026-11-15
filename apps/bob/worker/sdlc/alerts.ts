import { stripTerminalControls, type ItemSnapshot, type PlanSnapshot } from "@bob/sdlc-view";
import type { SqlPort } from "./sql";

/**
 * SDLC push alerts (BOB-81, BOB-75 Phase 4 task 4.1).
 *
 * The edge notices an item entering a state that needs a person (waiting-input, review,
 * failed) while it applies an ingest batch, inside the same transaction, and records it
 * in `sdlc_alerted` (one row per item: the state it was alerted in, and for waiting-input
 * the prompt). An item is alerted again only after it leaves that state (the row is
 * removed) or, for waiting-input, when a different prompt is pending. So a replay, a
 * resync snapshot, or a resourceVersion bump of an item already in the state never
 * re-alerts. An item the edge already held in the same state before it started keeping
 * rows (this feature's first deploy) is recorded without an alert, and the first snapshot
 * a fresh edge receives is a baseline: nothing in it alerts.
 *
 * After the commit the controller turns alerts into per-user deliveries, rate limited per
 * user (PUSH_LIMIT; extras coalesce into one summary, and past the limit they are dropped:
 * the Attention tab still shows them), and hands them to the Durable Object, which sends
 * them through Bob's notification service in the background (ctx.waitUntil). Ingest never
 * waits on, or fails because of, a push.
 */

export const ALERT_STATES = ["waiting-input", "review", "failed"] as const;
export type AlertState = (typeof ALERT_STATES)[number];
const ALERT_STATE_SET = new Set<string>(ALERT_STATES);

/** The Bob notification type per state (work_item_notification_type, migration 0042). */
export const SDLC_NOTIFICATION_TYPE = {
  "waiting-input": "sdlc_waiting_input",
  review: "sdlc_review",
  failed: "sdlc_failed",
} as const satisfies Record<AlertState, string>;
export type SdlcNotificationType = (typeof SDLC_NOTIFICATION_TYPE)[AlertState];

/** At most this many SDLC pushes per user per window; the last allowed slot becomes a summary. */
export const PUSH_LIMIT = { perUser: 10, windowMs: 10 * 60_000 } as const;
/** sdlc_alerted is pruned to items the edge still holds, and to this many rows. */
export const MAX_ALERTED_ROWS = 5_000;

export const ALERT_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS sdlc_alerted (item_id TEXT PRIMARY KEY, alert_key TEXT NOT NULL, rv INTEGER NOT NULL, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS sdlc_alerted_by_age ON sdlc_alerted (at)",
  // One row per push sent to a user, kept for PUSH_LIMIT.windowMs.
  "CREATE TABLE IF NOT EXISTS sdlc_alert_sends (user_id TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS sdlc_alert_sends_by_user ON sdlc_alert_sends (user_id, at)",
];

/** An item that newly entered an alert state in this batch. */
export interface ItemAlert { itemId: string; planId: string; state: AlertState; resourceVersion: number }

/** What the DO hands to Bob's notification service: one inbox row (and push) per entry. */
export interface SdlcAlertDelivery {
  userId: string;
  type: SdlcNotificationType;
  title: string;
  body: string;
  /** Null for a summary, which opens the Attention list. */
  itemId: string | null;
  url: string;
}

/** waiting-input is keyed by its prompt, so a new question on the same item alerts again. */
export function alertKey(item: Pick<ItemSnapshot, "state" | "pendingInput"> | undefined): string | null {
  if (!item || !ALERT_STATE_SET.has(item.state)) return null;
  return item.state === "waiting-input" ? `waiting-input:${item.pendingInput?.promptId ?? ""}` : item.state;
}

export class AlertLedger {
  constructor(private readonly sql: SqlPort) {}

  /**
   * Call inside the apply transaction, after the batch's items are written. `applied`: the
   * items that took effect; `previous`: those items as stored before the batch; `baseline`:
   * record without alerting (a fresh edge's first snapshot).
   */
  observe(applied: readonly ItemSnapshot[], previous: ReadonlyMap<string, ItemSnapshot>, baseline: boolean, now: number): ItemAlert[] {
    const alerts: ItemAlert[] = [];
    for (const item of applied) {
      const key = alertKey(item);
      const recorded = this.sql.exec<{ alert_key: string }>("SELECT alert_key FROM sdlc_alerted WHERE item_id = ?", item.itemId)[0];
      if (key === null) {
        if (recorded) this.sql.exec("DELETE FROM sdlc_alerted WHERE item_id = ?", item.itemId);
        continue;
      }
      if (recorded?.alert_key === key) continue;
      this.sql.exec(
        "INSERT INTO sdlc_alerted (item_id, alert_key, rv, at) VALUES (?, ?, ?, ?) ON CONFLICT (item_id) DO UPDATE SET alert_key = excluded.alert_key, rv = excluded.rv, at = excluded.at",
        item.itemId, key, item.resourceVersion, now,
      );
      if (baseline || alertKey(previous.get(item.itemId)) === key) continue;
      alerts.push({ itemId: item.itemId, planId: item.planId, state: item.state as AlertState, resourceVersion: item.resourceVersion });
    }
    return alerts;
  }

  /** Drops rows for items the edge no longer holds (ended plans, snapshots), then the oldest past the cap. */
  prune(): void {
    this.sql.exec("DELETE FROM sdlc_alerted WHERE item_id NOT IN (SELECT id FROM items)");
    this.sql.exec(
      "DELETE FROM sdlc_alerted WHERE item_id IN (SELECT item_id FROM sdlc_alerted ORDER BY at DESC, item_id LIMIT -1 OFFSET ?)",
      MAX_ALERTED_ROWS,
    );
  }

  /**
   * Per-user deliveries for `alerts`, within PUSH_LIMIT. Records each delivery as sent, in
   * one transaction. A user with no room left gets nothing; one with fewer slots than
   * alerts gets slots - 1 alerts and a summary of the rest.
   */
  plan(contents: readonly AlertContent[], userIds: readonly string[], now: number): SdlcAlertDelivery[] {
    if (contents.length === 0 || userIds.length === 0) return [];
    return this.sql.transaction(() => {
      this.sql.exec("DELETE FROM sdlc_alert_sends WHERE at <= ?", now - PUSH_LIMIT.windowMs);
      const out: SdlcAlertDelivery[] = [];
      for (const userId of userIds) {
        const used = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM sdlc_alert_sends WHERE user_id = ?", userId)[0]?.n ?? 0;
        const room = PUSH_LIMIT.perUser - used;
        if (room <= 0) continue;
        const single = contents.length <= room ? contents : contents.slice(0, room - 1);
        const mine: SdlcAlertDelivery[] = single.map((c) => ({ userId, ...c }));
        if (single.length < contents.length) mine.push({ userId, ...summarize(contents.slice(single.length)) });
        for (const _ of mine) this.sql.exec("INSERT INTO sdlc_alert_sends (user_id, at) VALUES (?, ?)", userId, now);
        out.push(...mine);
      }
      return out;
    });
  }
}

export type AlertContent = Omit<SdlcAlertDelivery, "userId">;

const QUESTION_CHARS = 140;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The inbox row and push for one alert: "BOB-71 needs your answer", with the repository and plan. */
export function describeAlert(alert: ItemAlert, item: ItemSnapshot | undefined, plan: PlanSnapshot | undefined): AlertContent {
  const def = plan?.definition.items.find((d) => d.itemId === alert.itemId);
  const name = clip(stripTerminalControls(def?.issue.identifier ?? def?.issue.issueId ?? alert.itemId), 80);
  const repo = def?.target.repository.repositoryId ?? item?.execution?.target.repository.repositoryId;
  const where = [repo && stripTerminalControls(repo), `plan ${stripTerminalControls(alert.planId)}`].filter(Boolean).join(" · ");
  const url = `/sdlc?item=${encodeURIComponent(alert.itemId)}`;
  const type = SDLC_NOTIFICATION_TYPE[alert.state];
  if (alert.state === "waiting-input") {
    const first = item?.pendingInput?.questions[0];
    const question = first ? clip(stripTerminalControls(first.question), QUESTION_CHARS) : "";
    return { type, title: `${name} needs your answer`, body: question ? `${where}: ${question}` : where, itemId: alert.itemId, url };
  }
  if (alert.state === "review") return { type, title: `${name} is ready for review`, body: where, itemId: alert.itemId, url };
  return { type, title: `${name} failed`, body: where, itemId: alert.itemId, url };
}

const URGENCY: SdlcNotificationType[] = ["sdlc_waiting_input", "sdlc_failed", "sdlc_review"];

/** One push for the alerts past a user's limit. Typed as the most urgent among them, so preferences still apply. */
function summarize(rest: readonly AlertContent[]): AlertContent {
  const type = URGENCY.find((t) => rest.some((c) => c.type === t)) ?? "sdlc_review";
  const names = rest.slice(0, 5).map((c) => c.title).join("; ");
  return {
    type,
    title: `${rest.length} more SDLC items need attention`,
    body: rest.length > 5 ? `${names}; and ${rest.length - 5} more` : names,
    itemId: null,
    url: "/sdlc",
  };
}
