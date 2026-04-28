"use client";

import { useCallback, useEffect, useRef } from "react";

import { useFileChangeEvents } from "./use-file-change-events";

interface UseFileSaveTriggerOptions {
  /** The session to watch for file changes */
  sessionId: string | null;
  /** Whether the trigger is active */
  enabled: boolean;
  /** Called when the debounced file-save trigger fires */
  onTrigger: () => void;
  /** Debounce interval in ms (default 500) */
  debounceMs?: number;
}

/**
 * Watches a session for file_change events and calls onTrigger after a
 * debounce period. If multiple file changes arrive in quick succession
 * (e.g. an agent writing several files), the timer resets each time so
 * onTrigger only fires once after the burst settles.
 */
export function useFileSaveTrigger({
  sessionId,
  enabled,
  onTrigger,
  debounceMs = 500,
}: UseFileSaveTriggerOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  const debounceMsRef = useRef(debounceMs);
  debounceMsRef.current = debounceMs;

  const handleFileChange = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onTriggerRef.current();
    }, debounceMsRef.current);
  }, []);

  // Clean up timer on unmount or when disabled
  useEffect(() => {
    if (!enabled && timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled]);

  useFileChangeEvents({
    sessionId,
    enabled,
    interval: 2_000,
    onFileChange: enabled ? handleFileChange : undefined,
  });
}
