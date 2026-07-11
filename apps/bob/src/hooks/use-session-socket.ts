"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BobWsClient,
  type ConnectionState as WsConnectionState,
  type ServerEvent,
  type ServerError,
  type ServerSessionStatusChanged,
  type ServerWorkspaceInvalidation,
  type SessionStatus,
  type EventDirection,
  type SessionEventType,
  type WorkspaceSessionInfo,
  type HostSnapshotWire,
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
  onWorkspaceSnapshot?: (sessions: WorkspaceSessionInfo[]) => void;
  onHostSnapshot?: (workspaceId: string, snapshot: HostSnapshotWire) => void;
  onWorkspaceStatusChanged?: (info: ServerSessionStatusChanged) => void;
  onWorkspaceEvent?: (message: ServerWorkspaceInvalidation) => void;
  onConnectionChange?: (state: ConnectionState) => void;
  enabled?: boolean;
}

export function useSessionSocket({
  gatewayUrl,
  token,
  onEvent,
  onStatusChange,
  onWorkspaceSnapshot,
  onHostSnapshot,
  onWorkspaceStatusChanged,
  onWorkspaceEvent,
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
  const onWorkspaceSnapshotRef = useRef(onWorkspaceSnapshot);
  const onHostSnapshotRef = useRef(onHostSnapshot);
  const onWorkspaceStatusChangedRef = useRef(onWorkspaceStatusChanged);
  const onWorkspaceEventRef = useRef(onWorkspaceEvent);
  const onConnectionChangeRef = useRef(onConnectionChange);
  onEventRef.current = onEvent;
  onStatusChangeRef.current = onStatusChange;
  onWorkspaceSnapshotRef.current = onWorkspaceSnapshot;
  onHostSnapshotRef.current = onHostSnapshot;
  onWorkspaceStatusChangedRef.current = onWorkspaceStatusChanged;
  onWorkspaceEventRef.current = onWorkspaceEvent;
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
      onWorkspaceSnapshot: (sessions: WorkspaceSessionInfo[]) => {
        onWorkspaceSnapshotRef.current?.(sessions);
      },
      onHostSnapshot: (workspaceId: string, snapshot: HostSnapshotWire) => {
        onHostSnapshotRef.current?.(workspaceId, snapshot);
      },
      onWorkspaceEvent: (message: ServerWorkspaceInvalidation) => {
        onWorkspaceEventRef.current?.(message);
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
    (statusFilter?: SessionStatus[], workspaceId?: string) => {
      clientRef.current?.subscribeWorkspace(statusFilter, workspaceId);
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
