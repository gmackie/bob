import { inScope, MAX_WATCHED_ITEMS, rows, shippedSince, startOfLocalDay, STATE_PRESENTATION } from "@bob/sdlc-view";
import type { Attention, CiMessage, CiPhase, EdgeView, ItemState, Row, Scope, ShippedEntry, TailFrame } from "@bob/sdlc-view";

import { hueFor } from "./floor";

/**
 * Agent Desks (BOB-98, BOB-91 phase 1): one card per item worth watching. Each card shows
 * that item's live agent tail and CI phases. The edge sends attempt detail only for watched
 * items, at most MAX_WATCHED_ITEMS per socket (BOB-94), so this file decides two things:
 * which items get a desk (chooseDesks) and what a desk shows (desks).
 *
 * Pure and deterministic. Web and native share it, and a desk only ever shows what the
 * edge sent. With no detail, a desk reads "no live detail" and stays still.
 */

/** Lower ranks win a desk. States without a rank never get one. */
const RANK: Partial<Record<ItemState, number>> = {
  running: 1,
  "waiting-input": 1,
  validating: 2,
  review: 2,
  deploying: 2,
  reserved: 3,
  "execution-unknown": 3,
};

/** An item's desk rank: needs-you first, then agents working, then checks, then starting; null for no desk. */
export function deskRank(row: Pick<Row, "attention"> & { item: { state: ItemState } }): number | null {
  const base = RANK[row.item.state];
  if (base === undefined) return null;
  return row.attention === "needs_human" ? 0 : base;
}

export interface ChooseDesksOptions {
  scope?: Scope;
  /** At most this many desks (default and maximum MAX_WATCHED_ITEMS). */
  limit?: number;
  /** Ids that must not get a desk, e.g. slots already taken. */
  exclude?: readonly string[];
}

/**
 * The items to give desks, in slot order. The best `limit` items by rank win. Among equal
 * ranks the previous desks stay, then the lower itemId wins. Kept desks hold their
 * previous order and new desks are appended in rank order, so cards don't jump around.
 * The same input always gives the same output.
 */
export function chooseDesks(view: EdgeView, previous: readonly string[] = [], options: ChooseDesksOptions = {}): string[] {
  const limit = Math.max(0, Math.min(options.limit ?? MAX_WATCHED_ITEMS, MAX_WATCHED_ITEMS));
  if (limit === 0) return [];
  const exclude = new Set(options.exclude ?? []);
  const prior = new Map(previous.map((id, i) => [id, i] as const));
  const ranked: { id: string; rank: number; kept: boolean }[] = [];
  for (const row of rows(view)) {
    if (exclude.has(row.item.itemId) || !inScope(row, options.scope ?? {})) continue;
    const rank = deskRank(row);
    if (rank !== null) ranked.push({ id: row.item.itemId, rank, kept: prior.has(row.item.itemId) });
  }
  ranked.sort((a, b) => a.rank - b.rank || Number(b.kept) - Number(a.kept) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const winners = ranked.slice(0, limit);
  const kept = winners.filter((w) => w.kept).sort((a, b) => (prior.get(a.id) ?? 0) - (prior.get(b.id) ?? 0));
  const fresh = winners.filter((w) => !w.kept);
  return [...kept, ...fresh].map((w) => w.id);
}

/** True when two desk choices name the same ids in the same order (skip re-sending a watch). */
export const sameDesks = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** What the edge has sent about one watched item. Missing fields mean nothing has arrived. */
export interface DeskDetail {
  tail?: TailFrame | null;
  ci?: CiMessage | null;
  /** The edge's reason the live tail is unavailable. */
  tailUnavailable?: string | null;
}

/** Tail lines a desk shows (the newest). */
export const DESK_LINES = 4;
/** A tail frame older than this reads as quiet: the agent may be thinking, or the relay is behind. */
export const DESK_QUIET_MS = 60_000;

export interface Desk {
  itemId: string;
  /** The tracker identifier (BOB-98), else the issue id. */
  label: string;
  repo: string;
  hue: number;
  state: ItemState;
  stateLabel: string;
  attention: Attention;
  /** The newest tail lines, oldest first; empty until a frame arrives. */
  lines: string[];
  /** The agent thread's status from the tail (running, waiting, ...), when there is a tail. */
  threadStatus: string | null;
  /** When the edge's tail frame was taken (epoch ms), when there is one. */
  tailAt: number | null;
  /** The tail is older than DESK_QUIET_MS. */
  quiet: boolean;
  /** CI detail when the edge has it. */
  ci: { summary: string; phases: CiPhase[] } | null;
  /** Why there is no live detail (the edge's reason), else null. */
  note: string | null;
  accessibilityLabel: string;
}

const tailTime = (frame: TailFrame): number | null => {
  const t = Date.parse(frame.at);
  return Number.isFinite(t) ? t : null;
};

/**
 * The desks for `ids` (from chooseDesks), in that order. Ids whose item has left the view
 * are skipped. `detail` gives what the edge has sent per item.
 */
export function desks(view: EdgeView, ids: readonly string[], detail: (itemId: string) => DeskDetail | undefined, now: number): Desk[] {
  const byId = new Map(rows(view).map((r) => [r.item.itemId, r] as const));
  const out: Desk[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const d = detail(id) ?? {};
    const tail = d.tail && d.tail.itemId === id ? d.tail : null;
    const tailAt = tail ? tailTime(tail) : null;
    const ci = d.ci?.available ? { summary: d.ci.summary, phases: d.ci.phases } : null;
    const note = tail ? null : d.tailUnavailable ?? (d.ci && !d.ci.available ? d.ci.reason : null);
    const label = row.issue.identifier ?? row.issue.issueId;
    const repo = row.target.repository.repositoryId;
    const stateLabel = STATE_PRESENTATION[row.item.state].label;
    const lines = tail ? tail.lines.slice(-DESK_LINES) : [];
    const quiet = tailAt !== null && now - tailAt > DESK_QUIET_MS;
    const said = lines.at(-1);
    out.push({
      itemId: id,
      label,
      repo,
      hue: hueFor(repo),
      state: row.item.state,
      stateLabel,
      attention: row.attention,
      lines,
      threadStatus: tail ? tail.threadStatus : null,
      tailAt,
      quiet,
      ci,
      note,
      accessibilityLabel: [
        `${label}, ${repo}, ${stateLabel}`,
        row.attention === "needs_human" ? "needs you" : null,
        ci ? `CI ${ci.summary}` : null,
        said ? `latest: ${said}` : note ? `no live detail: ${note}` : "no live detail yet",
      ].filter(Boolean).join(". "),
    });
  }
  return out;
}

/** How many items reached production since the start of the viewer's local day. */
export const shippedToday = (entries: readonly ShippedEntry[], now: number) => shippedSince(entries, startOfLocalDay(now)).length;
