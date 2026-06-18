"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BobWsClient,
  type ConnectionState as WsConnectionState,
  type ServerEvent,
  type ServerError,
  type ServerSessionStatusChanged,
  type SessionStatus,
  type EventDirection,
  type SessionEventType,
} from "@bob/ws";

// Re-export types that consumers depend on
export type { SessionStatus, EventDirection };
export type { SessionEventType };

export interface SessionEvent {
  type: "event";
  sessionId: string;
  seq: number;
  eventType: SessionEventType;
  direction: EventDirection;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface ConnectionState {
  status:
    | "disconnected"
    | "connecting"
    | "authenticating"
    | "connected"
    | "error";
  error?: string;
  reconnectAttempt?: number;
  reconnectIn?: number;
}

function mapConnectionState(ws: WsConnectionState): ConnectionState {
  switch (ws) {
    case "connecting":
      return { status: "connecting" };
    case "connected":
      return { status: "connected" };
    case "reconnecting":
      return { status: "connecting" };
    case "disconnected":
      return { status: "disconnected" };
  }
}

interface UseSessionSocketOptions {
  gatewayUrl: string;
  token: string;
  onEvent?: (event: SessionEvent) => void;
  onStatusChange?: (sessionId: string, status: SessionStatus) => void;
  onWorkspaceStatusChanged?: (info: ServerSessionStatusChanged) => void;
  onConnectionChange?: (state: ConnectionState) => void;
  enabled?: boolean;
}

export function useSessionSocket({
  gatewayUrl,
  token,
  onEvent,
  onStatusChange,
  onWorkspaceStatusChanged,
  onConnectionChange,
  enabled = true,
}: UseSessionSocketOptions) {
  const clientRef = useRef<BobWsClient | null>(null);
  const clientIdRef = useRef<string>(
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36),
  );

  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: "disconnected",
  });
  const [userId, setUserId] = useState<string | null>(null);

  // Stable refs for callbacks to avoid stale closures
  const onEventRef = useRef(onEvent);
  const onStatusChangeRef = useRef(onStatusChange);
  const onWorkspaceStatusChangedRef = useRef(onWorkspaceStatusChanged);
  const onConnectionChangeRef = useRef(onConnectionChange);
  onEventRef.current = onEvent;
  onStatusChangeRef.current = onStatusChange;
  onWorkspaceStatusChangedRef.current = onWorkspaceStatusChanged;
  onConnectionChangeRef.current = onConnectionChange;

  useEffect(() => {
    if (!enabled || !gatewayUrl || !token) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      setConnectionState({ status: "disconnected" });
      return;
    }

    const client = new BobWsClient({
      url: gatewayUrl,
      token,
      clientId: clientIdRef.current,
      deviceType: "web",
      onConnectionStateChange: (state: WsConnectionState) => {
        const mapped = mapConnectionState(state);
        setConnectionState(mapped);
        onConnectionChangeRef.current?.(mapped);
      },
      onEvent: (_sessionId: string, event: ServerEvent) => {
        const sessionEvent: SessionEvent = {
          type: "event",
          sessionId: event.sessionId,
          seq: event.seq,
          eventType: event.eventType,
          direction: event.direction,
          payload: event.payload,
          createdAt: event.createdAt,
        };
        onEventRef.current?.(sessionEvent);
      },
      onSessionStatus: (sessionId: string, status: SessionStatus) => {
        onStatusChangeRef.current?.(sessionId, status);
      },
      onSessionStatusChanged: (info: ServerSessionStatusChanged) => {
        onWorkspaceStatusChangedRef.current?.(info);
      },
      onError: (error: ServerError) => {
        console.error("[SessionSocket] Error:", error.code, error.message);
        if (error.code === "AUTH_FAILED") {
          setConnectionState({ status: "error", error: error.message });
        }
      },
    });

    clientRef.current = client;
    client.connect();

    return () => {
      clientRef.current = null;
      client.disconnect();
    };
  }, [enabled, gatewayUrl, token]);

  const subscribe = useCallback(
    (sessionId: string, lastAckSeq = 0) => {
      clientRef.current?.subscribe(sessionId, lastAckSeq);
    },
    [],
  );

  const unsubscribe = useCallback((sessionId: string) => {
    clientRef.current?.unsubscribe(sessionId);
  }, []);

  const sendInput = useCallback((sessionId: string, data: string) => {
    return clientRef.current?.sendInput(sessionId, data) ?? null;
  }, []);

  const createSession = useCallback(
    (config: {
      sessionId?: string;
      workingDirectory: string;
      agentType: string;
      worktreeId?: string;
      repositoryId?: string;
      title?: string;
    }) => {
      clientRef.current?.createSession(config);
    },
    [],
  );

  const stopSession = useCallback((sessionId: string) => {
    clientRef.current?.stopSession(sessionId);
  }, []);

  const subscribeWorkspace = useCallback(
    (statusFilter?: SessionStatus[]) => {
      clientRef.current?.subscribeWorkspace(statusFilter);
    },
    [],
  );

  const reconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current?.connect();
  }, []);

  return {
    connectionState,
    userId,
    subscribe,
    unsubscribe,
    subscribeWorkspace,
    sendInput,
    createSession,
    stopSession,
    reconnect,
  };
}
