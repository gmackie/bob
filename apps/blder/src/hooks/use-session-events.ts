"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

interface SessionEventRecord {
  id: string;
  sessionId: string;
  seq: number;
  direction: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

interface UseSessionEventsOptions {
  /** The session to poll events for */
  sessionId: string | null;
  /** Whether polling is enabled */
  enabled?: boolean;
  /** Polling interval in milliseconds (default 3000) */
  interval?: number;
  /** Only return events matching these types */
  eventTypes?: string[];
}

/**
 * Polls session events via trpc.session.getEvents at a configurable interval.
 * Tracks the latest seen sequence number so only new events are fetched.
 */
export function useSessionEvents({
  sessionId,
  enabled = true,
  interval = 3_000,
  eventTypes,
}: UseSessionEventsOptions) {
  const trpc = useTRPC();
  const active = Boolean(sessionId) && enabled;
  const activeId = sessionId ?? "";

  // Track the highest seq we've seen so we only fetch new events
  const lastSeqRef = useRef(0);

  const { data, isLoading, error } = useQuery(
    trpc.session.getEvents.queryOptions(
      { sessionId: activeId, fromSeq: lastSeqRef.current, limit: 200 },
      {
        enabled: active,
        refetchInterval: interval,
      },
    ),
  );

  // Advance the high-water mark when we receive events
  useEffect(() => {
    if (data?.events && data.events.length > 0) {
      const maxSeq = Math.max(
        ...data.events.map((e: SessionEventRecord) => e.seq),
      );
      if (maxSeq > lastSeqRef.current) {
        lastSeqRef.current = maxSeq;
      }
    }
  }, [data?.events]);

  // Reset high-water mark when session changes
  useEffect(() => {
    lastSeqRef.current = 0;
  }, [activeId]);

  // Filter by eventTypes if specified
  const events: SessionEventRecord[] =
    data?.events && eventTypes
      ? (data.events as SessionEventRecord[]).filter((e) =>
          eventTypes.includes(e.eventType),
        )
      : ((data?.events as SessionEventRecord[] | undefined) ?? []);

  return {
    events,
    latestSeq: data?.latestSeq ?? 0,
    isLoading,
    error,
  };
}
