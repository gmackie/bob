"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SessionStatus =
  | "provisioning"
  | "starting"
  | "running"
  | "idle"
  | "stopping"
  | "stopped"
  | "error";
export type EventDirection = "client" | "agent" | "system";
export type SessionEventType =
  | "output_chunk"
  | "message_final"
  | "input"
  | "tool_call"
  | "tool_result"
  | "state"
  | "error"
  | "heartbeat"
  | "transcript";

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

interface SubscribedSession {
  sessionId: string;
  status: SessionStatus;
  lastAckSeq: number;
}

interface UseSessionSocketOptions {
  gatewayUrl: string;
  token: string;
  onEvent?: (event: SessionEvent) => void;
  onStatusChange?: (sessionId: string, status: SessionStatus) => void;
  onConnectionChange?: (state: ConnectionState) => void;
  maxReconnectAttempts?: number;
  baseReconnectDelayMs?: number;
}

export function useSessionSocket({
  gatewayUrl,
  token,
  onEvent,
  onStatusChange,
  onConnectionChange,
  maxReconnectAttempts = 10,
  baseReconnectDelayMs = 1000,
}: UseSessionSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(crypto.randomUUID());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reconnectCountdownRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const subscribedSessionsRef = useRef<Map<string, SubscribedSession>>(
    new Map(),
  );
  const reconnectAttemptRef = useRef(0);
  const manualDisconnectRef = useRef(false);

  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: "disconnected",
  });
  const [userId, setUserId] = useState<string | null>(null);

  const updateConnectionState = useCallback(
    (state: ConnectionState) => {
      setConnectionState(state);
      onConnectionChange?.(state);
    },
    [onConnectionChange],
  );

  const clearReconnectTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (reconnectCountdownRef.current) {
      clearInterval(reconnectCountdownRef.current);
      reconnectCountdownRef.current = null;
    }
  }, []);

  const getReconnectDelay = useCallback(
    (attempt: number) => {
      const delay = Math.min(
        baseReconnectDelayMs * Math.pow(2, attempt),
        30000,
      );
      const jitter = Math.random() * 1000;
      return Math.floor(delay + jitter);
    },
    [baseReconnectDelayMs],
  );

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (!gatewayUrl || !token) return;

    manualDisconnectRef.current = false;
    updateConnectionState({ status: "connecting" });

    const ws = new WebSocket(gatewayUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      updateConnectionState({ status: "authenticating" });
      send({
        type: "hello",
        clientId: clientIdRef.current,
        deviceType: "web",
        token,
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        handleMessage(msg);
      } catch (e) {
        console.error("[SessionSocket] Failed to parse message:", e);
      }
    };

    ws.onclose = () => {
      updateConnectionState({ status: "disconnected" });
      scheduleReconnect();
    };

    ws.onerror = (error) => {
      console.error("[SessionSocket] WebSocket error:", error);
      updateConnectionState({ status: "error", error: "Connection error" });
    };
  }, [gatewayUrl, token, updateConnectionState, send]);

  const handleMessage = useCallback(
    (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "hello_ok":
          setUserId(msg.userId as string);
          reconnectAttemptRef.current = 0;
          updateConnectionState({ status: "connected" });
          resubscribeAll();
          break;

        case "subscribed": {
          const sessionId = msg.sessionId as string;
          const sub = subscribedSessionsRef.current.get(sessionId);
          if (sub) {
            sub.status = msg.currentState as SessionStatus;
            onStatusChange?.(sessionId, sub.status);
          }
          break;
        }

        case "event": {
          const event = msg as unknown as SessionEvent;
          const sub = subscribedSessionsRef.current.get(event.sessionId);
          if (sub) {
            sub.lastAckSeq = Math.max(sub.lastAckSeq, event.seq);
            send({ type: "ack", sessionId: event.sessionId, seq: event.seq });
          }

          if (event.eventType === "state" && event.payload.status) {
            onStatusChange?.(
              event.sessionId,
              event.payload.status as SessionStatus,
            );
          }

          onEvent?.(event);
          break;
        }

        case "input_ack":
          break;

        case "session_created":
          break;

        case "session_stopped":
          break;

        case "error":
          console.error("[SessionSocket] Server error:", msg.message);
          break;

        case "pong":
          break;
      }
    },
    [updateConnectionState, onEvent, onStatusChange, send],
  );

  const resubscribeAll = useCallback(() => {
    for (const [sessionId, sub] of subscribedSessionsRef.current) {
      send({
        type: "subscribe",
        sessionId,
        lastAckSeq: sub.lastAckSeq,
      });
    }
  }, [send]);

  const scheduleReconnect = useCallback(() => {
    if (manualDisconnectRef.current) return;
    if (reconnectAttemptRef.current >= maxReconnectAttempts) {
      updateConnectionState({
        status: "error",
        error: "Max reconnection attempts reached",
        reconnectAttempt: reconnectAttemptRef.current,
      });
      return;
    }

    clearReconnectTimers();

    const delay = getReconnectDelay(reconnectAttemptRef.current);
    let remaining = Math.ceil(delay / 1000);

    updateConnectionState({
      status: "disconnected",
      reconnectAttempt: reconnectAttemptRef.current,
      reconnectIn: remaining,
    });

    reconnectCountdownRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        updateConnectionState({
          status: "disconnected",
          reconnectAttempt: reconnectAttemptRef.current,
          reconnectIn: remaining,
        });
      }
    }, 1000);

    reconnectTimeoutRef.current = setTimeout(() => {
      clearReconnectTimers();
      reconnectAttemptRef.current += 1;
      connect();
    }, delay);
  }, [
    connect,
    maxReconnectAttempts,
    getReconnectDelay,
    clearReconnectTimers,
    updateConnectionState,
  ]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    clearReconnectTimers();
    wsRef.current?.close();
    wsRef.current = null;
    reconnectAttemptRef.current = 0;
    updateConnectionState({ status: "disconnected" });
  }, [updateConnectionState, clearReconnectTimers]);

  const subscribe = useCallback(
    (sessionId: string, lastAckSeq = 0) => {
      subscribedSessionsRef.current.set(sessionId, {
        sessionId,
        status: "stopped",
        lastAckSeq,
      });

      if (connectionState.status === "connected") {
        send({ type: "subscribe", sessionId, lastAckSeq });
      }
    },
    [connectionState.status, send],
  );

  const unsubscribe = useCallback(
    (sessionId: string) => {
      subscribedSessionsRef.current.delete(sessionId);

      if (connectionState.status === "connected") {
        send({ type: "unsubscribe", sessionId });
      }
    },
    [connectionState.status, send],
  );

  const sendInput = useCallback(
    (sessionId: string, data: string) => {
      const clientInputId = crypto.randomUUID();
      send({
        type: "input",
        sessionId,
        clientInputId,
        data,
      });
      return clientInputId;
    },
    [send],
  );

  const createSession = useCallback(
    (config: {
      workingDirectory: string;
      agentType: string;
      worktreeId?: string;
      repositoryId?: string;
      title?: string;
    }) => {
      send({
        type: "create_session",
        ...config,
      });
    },
    [send],
  );

  const stopSession = useCallback(
    (sessionId: string) => {
      send({ type: "stop_session", sessionId });
    },
    [send],
  );

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    connectionState,
    userId,
    subscribe,
    unsubscribe,
    sendInput,
    createSession,
    stopSession,
    reconnect: connect,
  };
}
