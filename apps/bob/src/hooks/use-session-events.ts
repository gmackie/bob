"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { useBobQueryClient } from "~/rpc/react";

import type { BobRpcOutput } from "@gmacko/bob-client/query";

type SessionEventRecord =
  BobRpcOutput<"agent.session.getEvents">["events"][number];

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
 * Polls session events via bobQuery("agent.session.getEvents") at a configurable interval.
 * Tracks the latest seen sequence number so only new events are fetched.
 */
export function useSessionEvents({
  sessionId,
  enabled = true,
  interval = 3_000,
  eventTypes,
}: UseSessionEventsOptions) {
  const bobQuery = useBobQueryClient();
  const active = Boolean(sessionId) && enabled;
  const activeId = sessionId ?? "";

  // Track the highest seq we've seen so we only fetch new events
  const lastSeqRef = useRef(0);

  const { data, isLoading, error } = useQuery(
    bobQuery("agent.session.getEvents").queryOptions(
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
  const events: readonly SessionEventRecord[] =
    data?.events && eventTypes
      ? data.events.filter((e) => eventTypes.includes(e.eventType))
      : (data?.events ?? []);

  return {
    events,
    latestSeq: data?.latestSeq ?? 0,
    isLoading,
    error,
  };
}
