// BOB-96: the server side of the iOS Live Activity (BOB-91 "Glance"). Activity push tokens
// registered over the socket are kept in the DO's SQLite; after every ingest the edge works
// out which activities' content changed and hands those sends to apns.ts in the background.
import {
  isActivityToken,
  LIVE_ACTIVITY_LIMITS,
  liveActivityContent,
  type ItemSnapshot,
  type LiveActivityContent,
  type LiveActivityRegistration,
  type PlanSnapshot,
} from "@bob/sdlc-view";
import { mayWatch, readAttachment, type AttachedSocket } from "./edge-sockets";
import type { SqlPort } from "./sql";

export const LIVE_ACTIVITY_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS sdlc_live_activities (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL, sent_at INTEGER, sent_json TEXT)",
  "CREATE INDEX IF NOT EXISTS sdlc_live_activities_by_user ON sdlc_live_activities (user_id, created_at)",
];

/** One APNs liveactivity push to make. */
export interface LiveActivitySend {
  token: string;
  event: "update" | "end";
  content: LiveActivityContent;
  /** 10 when the item newly needs you or the activity ends, else 5 (APNs budgets priority 10). */
  priority: 5 | 10;
  /** Shown (and lights up the Dynamic Island) when the item newly needs you. No agent text. */
  alert: { title: string; body: string } | null;
}

/** A registration is small; anything longer is ignored unread. */
export const MAX_REGISTRATION_CHARS = 1024;

/** Parses `{type:"liveActivity", itemId, token: hex|null}`; anything else is null. */
export function parseLiveActivityRegistration(message: string | ArrayBuffer): LiveActivityRegistration | null {
  if (typeof message !== "string" || message.length > MAX_REGISTRATION_CHARS) return null;
  let value: unknown;
  try { value = JSON.parse(message); } catch { return null; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { type, itemId, token } = value as Record<string, unknown>;
  if (type !== "liveActivity" || typeof itemId !== "string" || itemId.length === 0 || itemId.length > 200) return null;
  if (token === null) return { type: "liveActivity", itemId, token: null };
  return isActivityToken(token) ? { type: "liveActivity", itemId, token: token.toLowerCase() } : null;
}

type Row = { token: string; user_id: string; item_id: string; created_at: number; sent_at: number | null; sent_json: string | null };

export interface LiveActivityEdgeOptions {
  sql: SqlPort;
  item: (itemId: string) => ItemSnapshot | undefined;
  plan: (planId: string) => PlanSnapshot | undefined;
  /** SDLC_VIEWER_USER_IDS as it is now. */
  viewerIds: () => string | undefined;
  /** Hands planned sends to APNs in the background (ctx.waitUntil in the DO); must not block. */
  send: (sends: LiveActivitySend[]) => void;
}

export class LiveActivityEdge {
  constructor(private readonly options: LiveActivityEdgeOptions) {}

  /**
   * A registration from a socket. Ignored unless the socket may watch. A token is stored
   * for the socket's user and item (a token seen before moves to them); past
   * LIVE_ACTIVITY_LIMITS.perUser the user's oldest are dropped. token null forgets the
   * user's activities for the item. Returns whether anything was stored or removed.
   */
  register(socket: AttachedSocket, message: LiveActivityRegistration, now: number): boolean {
    const attachment = readAttachment(socket);
    if (!mayWatch(attachment, this.options.viewerIds())) return false;
    const userId = attachment.userId!;
    const { sql } = this.options;
    if (message.token === null) {
      sql.exec("DELETE FROM sdlc_live_activities WHERE user_id = ? AND item_id = ?", userId, message.itemId);
      return true;
    }
    sql.transaction(() => {
      sql.exec(
        "INSERT INTO sdlc_live_activities (token, user_id, item_id, created_at, sent_at, sent_json) VALUES (?, ?, ?, ?, NULL, NULL) " +
          "ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, item_id = excluded.item_id, created_at = excluded.created_at, sent_at = NULL, sent_json = NULL",
        message.token, userId, message.itemId, now,
      );
      sql.exec(
        "DELETE FROM sdlc_live_activities WHERE token IN (SELECT token FROM sdlc_live_activities WHERE user_id = ? ORDER BY created_at DESC, token LIMIT -1 OFFSET ?)",
        userId, LIVE_ACTIVITY_LIMITS.perUser,
      );
    });
    return true;
  }

  /**
   * After every ingest (heartbeats included, so held-back updates go out within a few
   * seconds of their interval ending). For each registered activity: forget it past
   * tokenTtlMs or once its user is off the allow-list; otherwise compare its item's content
   * with what was last sent. A change is sent at once when the item newly needs you or the
   * activity ends, else no sooner than minIntervalMs after the last send. An item the edge no
   * longer holds (its plan ended) ends the activity with the last content sent. Ended
   * activities are forgotten. Returns the sends handed off.
   */
  flush(now: number): LiveActivitySend[] {
    const { sql } = this.options;
    const rows = sql.exec<Row>("SELECT token, user_id, item_id, created_at, sent_at, sent_json FROM sdlc_live_activities");
    if (rows.length === 0) return [];
    const viewers = this.options.viewerIds();
    const sends: LiveActivitySend[] = [];
    sql.transaction(() => {
      for (const row of rows) {
        if (now - Number(row.created_at) > LIVE_ACTIVITY_LIMITS.tokenTtlMs || !mayWatch({ greeted: true, userId: row.user_id }, viewers)) {
          sql.exec("DELETE FROM sdlc_live_activities WHERE token = ?", row.token);
          continue;
        }
        const last = row.sent_json === null ? null : (JSON.parse(row.sent_json) as LiveActivityContent);
        const item = this.options.item(row.item_id);
        const content = item ? liveActivityContent(item, this.options.plan(item.planId)) : last ? { ...last, ended: true } : null;
        if (content === null) continue; // registered for an item the edge has not seen yet
        const json = JSON.stringify(content);
        if (json === row.sent_json) continue;
        const urgent = content.ended || (content.needsYou && !last?.needsYou);
        if (!urgent && row.sent_at !== null && now - Number(row.sent_at) < LIVE_ACTIVITY_LIMITS.minIntervalMs) continue;
        const subject = content.issue ?? content.repository ?? "An item";
        sends.push({
          token: row.token,
          event: content.ended ? "end" : "update",
          content,
          priority: urgent ? 10 : 5,
          alert: content.needsYou && !last?.needsYou && !content.ended ? { title: `${subject} needs you`, body: content.label } : null,
        });
        if (content.ended) sql.exec("DELETE FROM sdlc_live_activities WHERE token = ?", row.token);
        else sql.exec("UPDATE sdlc_live_activities SET sent_at = ?, sent_json = ? WHERE token = ?", now, json, row.token);
      }
    });
    if (sends.length > 0) {
      try { this.options.send(sends); } catch { /* sending never fails an ingest */ }
    }
    return sends;
  }

  /** APNs said the token is dead (410, BadDeviceToken): forget it. */
  forget(tokens: readonly string[]): void {
    for (const token of tokens) this.options.sql.exec("DELETE FROM sdlc_live_activities WHERE token = ?", token);
  }

  count(): number {
    return Number(this.options.sql.exec<{ n: number }>("SELECT count(*) AS n FROM sdlc_live_activities")[0]?.n ?? 0);
  }
}
