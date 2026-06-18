"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

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

  const { events, latestSeq, isLoading } = useSessionEvents({
    sessionId,
    enabled,
    interval,
    eventTypes: ["file_change"],
  });

  // Reset processed seqs when session changes
  useEffect(() => {
    processedSeqsRef.current = new Set();
  }, [sessionId]);

  // Process new file_change events
  useEffect(() => {
    if (!events || events.length === 0) return;

    for (const event of events) {
      if (processedSeqsRef.current.has(event.seq)) continue;
      processedSeqsRef.current.add(event.seq);

      const payload = event.payload as unknown as FileChangePayload;
      if (!payload?.path) continue;

      // Invalidate the filesystem.list query for the parent directory
      const parentDir = payload.path.replace(/\/[^/]+$/, "") || "/";
      void queryClient.invalidateQueries({
        queryKey: trpc.filesystem.list.queryKey({ path: parentDir, showHidden: false }),
      });

      // Also invalidate without showHidden to catch both variants
      void queryClient.invalidateQueries({
        queryKey: trpc.filesystem.list.queryKey({ path: parentDir, showHidden: true }),
      });

      onFileChange?.(payload);
    }
  }, [events, queryClient, trpc.filesystem.list, onFileChange]);

  return {
    latestSeq,
    isLoading,
    /** Number of file changes detected so far */
    changeCount: processedSeqsRef.current.size,
  };
}
