"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Buddy SSE event types.
 *
 * The server's NOTIFY payloads (see packages/db/drizzle/custom/001_buddy_notify.sql)
 * only include primary keys + minimal metadata. Richer fields below (args, result,
 * duration_ms, status) are optional and only populate once the producer side
 * joins the full row into the NOTIFY payload.
 *
 * Event names on the wire match the Postgres channel names:
 *   buddy_tool_call    buddy_dive_update    buddy_inbox_new
 */
export interface ToolCallEvent {
  id: number | string;
  thread_id: string | null;
  tool_name: string;
  /** Raw TG_OP from the producer — "INSERT" | "UPDATE" in practice, string for forward-compat. */
  op: string;
  /** Optional enrichment the producer may add later. */
  status?: string | null;
  duration_ms?: number | null;
  args?: unknown;
  result?: unknown;
  received_at: number;
}

export interface DiveUpdateEvent {
  id: number | string;
  thread_id: string | null;
  status: string;
  op: string;
  received_at: number;
}

export interface InboxEvent {
  id: number | string;
  source_id: number | string;
  vault: string;
  op: string;
  received_at: number;
}

export type BuddyConnectionStatus = "connecting" | "open" | "error";

export interface UseBuddyEventsResult {
  toolCalls: ToolCallEvent[];
  diveUpdates: DiveUpdateEvent[];
  inboxItems: InboxEvent[];
  status: BuddyConnectionStatus;
}

const MAX_EVENTS = 100;

function prepend<T>(list: T[], item: T): T[] {
  const next = [item, ...list];
  if (next.length > MAX_EVENTS) next.length = MAX_EVENTS;
  return next;
}

export function useBuddyEvents(threadId: string): UseBuddyEventsResult {
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([]);
  const [diveUpdates, setDiveUpdates] = useState<DiveUpdateEvent[]>([]);
  const [inboxItems, setInboxItems] = useState<InboxEvent[]>([]);
  const [status, setStatus] = useState<BuddyConnectionStatus>("connecting");

  // Track the live EventSource so cleanup always closes the exact instance
  // that was opened for this effect run.
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    // Initial state is "connecting"; rely on onopen/onerror to advance it so
    // we don't trigger a synchronous setState inside the effect body.
    const url = `/api/buddy/events?threadId=${encodeURIComponent(threadId)}`;
    const es = new EventSource(url);
    sourceRef.current = es;

    es.onopen = () => {
      setStatus("open");
    };

    es.onerror = () => {
      // EventSource has its own reconnect loop — don't fight it.
      setStatus("error");
    };

    const parse = <T,>(raw: string): T | null => {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    };

    const rawData = (ev: MessageEvent): string =>
      typeof ev.data === "string" ? ev.data : String(ev.data);

    const handleToolCall = (ev: MessageEvent) => {
      const payload = parse<Omit<ToolCallEvent, "received_at">>(rawData(ev));
      if (!payload) return;
      setToolCalls((prev) => prepend(prev, { ...payload, received_at: Date.now() }));
    };

    const handleDiveUpdate = (ev: MessageEvent) => {
      const payload = parse<Omit<DiveUpdateEvent, "received_at">>(rawData(ev));
      if (!payload) return;
      setDiveUpdates((prev) => prepend(prev, { ...payload, received_at: Date.now() }));
    };

    const handleInbox = (ev: MessageEvent) => {
      const payload = parse<Omit<InboxEvent, "received_at">>(rawData(ev));
      if (!payload) return;
      setInboxItems((prev) => prepend(prev, { ...payload, received_at: Date.now() }));
    };

    es.addEventListener("buddy_tool_call", handleToolCall as EventListener);
    es.addEventListener("buddy_dive_update", handleDiveUpdate as EventListener);
    es.addEventListener("buddy_inbox_new", handleInbox as EventListener);

    return () => {
      es.removeEventListener("buddy_tool_call", handleToolCall as EventListener);
      es.removeEventListener("buddy_dive_update", handleDiveUpdate as EventListener);
      es.removeEventListener("buddy_inbox_new", handleInbox as EventListener);
      es.close();
      if (sourceRef.current === es) sourceRef.current = null;
    };
  }, [threadId]);

  return { toolCalls, diveUpdates, inboxItems, status };
}
