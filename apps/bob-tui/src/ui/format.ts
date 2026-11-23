// Text helpers for the panes, kept out of the components so tests can pin them.
import { isOffline, STATE_PRESENTATION, type Attention, type EdgeView, type ItemState } from "@bob/sdlc-view";

import type { Connection } from "../client/session";

export const ATTENTION_COLOR: Record<Attention, string> = { needs_human: "yellow", failed: "red", stalled: "magenta", ok: "green" };
export const ATTENTION_MARK: Record<Attention, string> = { needs_human: "?", failed: "✗", stalled: "~", ok: "·" };

const PLAN_LABEL: Record<string, string> = { draft: "Draft", active: "Active", paused: "Paused", cancelling: "Cancelling", cancelled: "Cancelled", completed: "Completed" };
export const planStateLabel = (state: string) => PLAN_LABEL[state] ?? state;
export const PLAN_COLOR: Record<string, string> = { draft: "gray", active: "green", paused: "yellow", cancelling: "red" };

export function stateBadge(state: string | null | undefined): { text: string; color: string } {
  if (!state) return { text: "no snapshot", color: "gray" };
  const p = STATE_PRESENTATION[state as ItemState];
  if (!p) return { text: state, color: "gray" };
  return { text: p.label, color: state === "completed" ? "cyan" : ATTENTION_COLOR[p.attention] };
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export function connectionText(connection: Connection): { text: string; color: string } {
  switch (connection) {
    case "live": return { text: "● live", color: "green" };
    case "connecting": return { text: "○ connecting", color: "yellow" };
    case "reconnecting": return { text: "○ reconnecting", color: "yellow" };
    case "auth-failed": return { text: "✗ auth failed", color: "red" };
  }
}

export function coordinatorText(view: EdgeView, now: number): { text: string; color: string } {
  if (view.epoch === null) return { text: "coordinator ?", color: "gray" };
  if (view.coordinatorSeenAt === null) return { text: "coordinator offline (never seen)", color: "red" };
  if (isOffline(view, now)) return { text: `coordinator offline since ${ago(now - view.coordinatorSeenAt)} ago`, color: "red" };
  return { text: "coordinator online", color: "green" };
}

/** Why commands cannot be sent now, else null. */
export function blockedReason(connection: Connection, view: EdgeView, now: number): string | null {
  if (connection !== "live") return "not connected to the SDLC edge";
  if (view.epoch === null) return "waiting for the first snapshot";
  if (isOffline(view, now)) return "the coordinator is offline";
  return null;
}

export const truncate = (s: string, n: number) => (n <= 1 ? s.slice(0, Math.max(0, n)) : s.length > n ? `${s.slice(0, n - 1)}…` : s);
