/**
 * Shipped (BOB-95): when items reached production, for "shipped today" views (the Arcade
 * wallboard, BOB-91). The edge records the first time an item gains the production-verified
 * milestone, at its own receive time, and keeps the record after the plan ends.
 *
 * Opt-in: a client sends ShippedRequest; the edge answers with every entry it holds
 * (replace: true) and from then on sends that socket each new entry (replace: false).
 * Clients that never ask are sent nothing new. The edge keeps SHIPPED_WINDOW_MS, enough
 * for "today" in any time zone; the client picks its own day (shippedSince).
 */

/** Client → edge: send me what shipped, and keep me posted. */
export interface ShippedRequest { type: "shipped" }

export interface ShippedEntry {
  itemId: string;
  planId: string;
  /** The tracker identifier (e.g. "BOB-95"), when the plan gave one. */
  issue: string | null;
  /** The target repository id (e.g. "bob"). */
  repository: string | null;
  /** Epoch milliseconds, the edge's clock, when the edge saw production-verified. */
  at: number;
}

/** Edge → opted-in socket. replace: the full list (on request); otherwise entries to add. */
export interface ShippedMessage { type: "shipped"; replace: boolean; entries: ShippedEntry[] }

/** How long the edge keeps entries: 48 h covers "today" in every time zone. */
export const SHIPPED_WINDOW_MS = 48 * 60 * 60_000;
/** At most this many entries are kept (newest first). */
export const MAX_SHIPPED_ENTRIES = 500;

/** Folds a ShippedMessage into a client's list: newest first, one entry per item, capped. */
export function mergeShipped(current: readonly ShippedEntry[], message: ShippedMessage): ShippedEntry[] {
  const byItem = new Map<string, ShippedEntry>();
  for (const entry of message.replace ? message.entries : [...message.entries, ...current]) {
    const held = byItem.get(entry.itemId);
    if (!held || entry.at < held.at) byItem.set(entry.itemId, entry);
  }
  return [...byItem.values()].sort((a, b) => b.at - a.at || a.itemId.localeCompare(b.itemId)).slice(0, MAX_SHIPPED_ENTRIES);
}

/** Entries at or after `since` (e.g. the start of the viewer's local day), newest first. */
export const shippedSince = (entries: readonly ShippedEntry[], since: number) => entries.filter((e) => e.at >= since);

/** The start of the local day containing `now`, in the runtime's time zone. */
export function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
const nullableText = (v: unknown) => v === null || (typeof v === "string" && v.length <= 200);

/** Parses a ShippedMessage (clients use this); null when it is not one. Malformed entries refuse the message. */
export function parseShippedMessage(data: unknown): ShippedMessage | null {
  let value: unknown = data;
  if (typeof data === "string") { try { value = JSON.parse(data); } catch { return null; } }
  if (!isRecord(value) || value.type !== "shipped" || typeof value.replace !== "boolean" || !Array.isArray(value.entries)) return null;
  const entries: ShippedEntry[] = [];
  for (const e of value.entries) {
    if (!isRecord(e) || !isId(e.itemId) || !isId(e.planId) || !nullableText(e.issue) || !nullableText(e.repository) || !Number.isFinite(e.at)) return null;
    entries.push({ itemId: e.itemId, planId: e.planId, issue: e.issue as string | null, repository: e.repository as string | null, at: e.at as number });
  }
  return { type: "shipped", replace: value.replace, entries };
}
