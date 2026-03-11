"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { SSEEventType } from "./sse-server";
import type { RepoWorktreeStatus } from "./sse-server";

interface UseSSEOptions {
  workspaceId: string;
  enabled?: boolean;
  onReconnect?: () => void;
}

type SSEEventHandler<T = unknown> = (data: T) => void;

export function useSSE({ workspaceId, enabled = true, onReconnect }: UseSSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef<Map<string, Set<SSEEventHandler>>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const BASE_RECONNECT_DELAY = 1000;

  const connect = useCallback(() => {
    if (!enabled || !workspaceId) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `/api/sse?workspaceId=${encodeURIComponent(workspaceId)}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
      onReconnect?.();
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();

      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connect();
        }, delay);
      }
    };

    return () => {
      eventSource.close();
    };
  }, [workspaceId, enabled, onReconnect]);

  useEffect(() => {
    const cleanup = connect();

    return () => {
      cleanup?.();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect]);

  const subscribe = useCallback(
    <T = unknown>(eventType: SSEEventType | string, handler: SSEEventHandler<T>) => {
      if (!handlersRef.current.has(eventType)) {
        handlersRef.current.set(eventType, new Set());

        eventSourceRef.current?.addEventListener(eventType, (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data) as T;
            handlersRef.current.get(eventType)?.forEach((h) => h(data));
          } catch {
            void 0;
          }
        });
      }

      handlersRef.current.get(eventType)?.add(handler as SSEEventHandler);

      return () => {
        handlersRef.current.get(eventType)?.delete(handler as SSEEventHandler);
      };
    },
    []
  );

  return { isConnected, subscribe };
}

export function useSSEEvent<T = unknown>(
  sse: ReturnType<typeof useSSE>,
  eventType: SSEEventType | string,
  handler: SSEEventHandler<T>
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return sse.subscribe<T>(eventType, (data) => handlerRef.current(data));
  }, [sse, eventType]);
}

export interface IssueUpdateEvent {
  id: string;
  workspaceId: string;
  projectId: string;
  status?: string;
  kanbanRank?: string;
  title?: string;
  assigneeId?: string | null;
}

export interface IssueCreateEvent {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  status: string;
  identifier: string;
}

export interface IssueDeleteEvent {
  id: string;
  workspaceId: string;
  projectId: string;
}

export type RepoWorktreeStatusEvent = RepoWorktreeStatus;

export function useIssueUpdates(
  workspaceId: string,
  callbacks: {
    onIssueCreated?: (data: IssueCreateEvent) => void;
    onIssueUpdated?: (data: IssueUpdateEvent) => void;
    onIssueDeleted?: (data: IssueDeleteEvent) => void;
  }
) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const sse = useSSE({ workspaceId });

  useEffect(() => {
    const unsubCreate = sse.subscribe<IssueCreateEvent>("issue:created", (data) => {
      callbacksRef.current.onIssueCreated?.(data);
    });

    const unsubUpdate = sse.subscribe<IssueUpdateEvent>("issue:updated", (data) => {
      callbacksRef.current.onIssueUpdated?.(data);
    });

    const unsubDelete = sse.subscribe<IssueDeleteEvent>("issue:deleted", (data) => {
      callbacksRef.current.onIssueDeleted?.(data);
    });

    return () => {
      unsubCreate();
      unsubUpdate();
      unsubDelete();
    };
  }, [sse]);

  return sse;
}

export function useRepoWorktreeStatus(
  workspaceId: string,
  callback: (event: RepoWorktreeStatusEvent) => void
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const sse = useSSE({ workspaceId });

  useEffect(() => {
  const unsub = sse.subscribe<RepoWorktreeStatus>("repo-worktree:status_updated", (data) => {
      callbackRef.current(data);
    });

    return unsub;
  }, [sse]);

  return sse;
}
