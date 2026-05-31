"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { SessionEvent } from "~/hooks/use-session-socket";
import { useSessionSocket } from "~/hooks/use-session-socket";
import { useTRPC } from "~/trpc/react";
import { useSessionEvents } from "./use-session-events";

interface FileChangePayload {
  path: string;
  action: "created" | "modified" | "deleted";
}

interface UseFileChangeEventsOptions {
  /** The session to watch for file changes */
  sessionId: string | null;
  /** Whether the hook is active */
  enabled?: boolean;
  /** Polling interval in ms (default 3000) */
  interval?: number;
  /** Called with each new file change event */
  onFileChange?: (change: FileChangePayload) => void;
}

/**
 * Watches a session for file_change events and auto-invalidates
 * the filesystem.list query for the parent directory of each changed file.
 */
export function useFileChangeEvents({
  sessionId,
  enabled = true,
  interval = 3_000,
  onFileChange,
}: UseFileChangeEventsOptions) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Track which event seqs we've already processed to avoid duplicate callbacks
  const processedSeqsRef = useRef<Set<number>>(new Set());
  const active = Boolean(sessionId) && enabled;

  const { events, latestSeq, isLoading } = useSessionEvents({
    sessionId,
    enabled,
    interval,
    eventTypes: ["file_change"],
  });

  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(undefined, {
      enabled: active,
      staleTime: 60_000,
    }),
  );

  // Reset processed seqs when session changes
  useEffect(() => {
    processedSeqsRef.current = new Set();
  }, [sessionId]);

  const processEvent = useCallback(
    (event: { seq: number; payload: Record<string, unknown> }) => {
      if (processedSeqsRef.current.has(event.seq)) return;
      processedSeqsRef.current.add(event.seq);

      const payload = event.payload as unknown as FileChangePayload;
      if (!payload?.path) return;

      // Invalidate the filesystem.list query for the parent directory
      const parentDir = payload.path.replace(/\/[^/]+$/, "") || "/";
      void queryClient.invalidateQueries({
        queryKey: trpc.filesystem.list.queryKey({
          path: parentDir,
          showHidden: false,
        }),
      });

      // Also invalidate without showHidden to catch both variants
      void queryClient.invalidateQueries({
        queryKey: trpc.filesystem.list.queryKey({
          path: parentDir,
          showHidden: true,
        }),
      });

      onFileChange?.(payload);
    },
    [queryClient, trpc.filesystem.list, onFileChange],
  );

  const handleSocketEvent = useCallback(
    (event: SessionEvent) => {
      if (event.eventType === "file_change") {
        processEvent(event);
      }
    },
    [processEvent],
  );

  const { connectionState, subscribe, unsubscribe } = useSessionSocket({
    gatewayUrl: gatewayInfo?.url ?? "",
    token: gatewayInfo?.token ?? "",
    onEvent: handleSocketEvent,
    enabled: active && Boolean(gatewayInfo?.token),
  });

  useEffect(() => {
    if (!sessionId || connectionState.status !== "connected") return;
    subscribe(sessionId, latestSeq);
    return () => unsubscribe(sessionId);
  }, [connectionState.status, latestSeq, sessionId, subscribe, unsubscribe]);

  // Process new file_change events from the polling fallback.
  useEffect(() => {
    if (!events || events.length === 0) return;
    for (const event of events) {
      processEvent(event);
    }
  }, [events, processEvent]);

  return {
    latestSeq,
    isLoading,
    /** Number of file changes detected so far */
    changeCount: processedSeqsRef.current.size,
  };
}
