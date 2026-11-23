// The edge socket protocol helpers, ported from apps/bob/src/components/sdlc/edge-client.ts
// (that module lives in the web app and is not importable from Node without bundling it).
import type { EdgeMessage, EdgeView } from "@bob/sdlc-view";

export interface HelloMessage { type: "hello"; cursor: number | null; epoch: string | null }

/** Resume from the view's seq and epoch, or ask for a snapshot when there is no view or it needs a resync. */
export function helloFor(view: EdgeView): HelloMessage {
  if (view.epoch === null || view.needsResync) return { type: "hello", cursor: null, epoch: null };
  return { type: "hello", cursor: view.seq, epoch: view.epoch };
}

/** One already-parsed socket message as an edge message, else null. */
export function asEdgeMessage(value: unknown): EdgeMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Partial<EdgeMessage> & Record<string, unknown>;
  if (message.type === "status") return message as EdgeMessage;
  if (message.type !== "snapshot" && message.type !== "delta") return null;
  if (!Number.isSafeInteger(message.seq) || !Array.isArray(message.plans) || !Array.isArray(message.items)) return null;
  if (message.type === "snapshot" && (typeof message.epoch !== "string" || !Array.isArray(message.topology))) return null;
  return message as EdgeMessage;
}

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
export const RECONNECT_JITTER = 0.2;

/** Capped exponential backoff, 1 s … 30 s, ±20%. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(base * (1 - RECONNECT_JITTER + 2 * RECONNECT_JITTER * random()));
}

/** A socket counts as healthy once the edge sent a valid message on it, not when it opens. */
export function createBackoff(random: () => number = Math.random) {
  let attempt = 0;
  return {
    heard() { attempt = 0; },
    nextDelay() { return reconnectDelay(attempt++, random); },
  };
}
