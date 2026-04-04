import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { v4 as uuid } from "uuid";

import {
  BobWsClient,
  type ConnectionState,
  type ServerEvent,
  type ServerError,
  type ServerSessionStatusChanged,
  type SessionStatus,
  type WorkspaceSessionInfo,
} from "@bob/ws";

import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";

function getGatewayWsUrl(): string {
  const apiUrl = getBaseUrl();
  // API runs on :3000, gateway on :3002. Replace port and protocol.
  const parsed = new URL(apiUrl);
  const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${parsed.hostname}:3002/sessions`;
}

export interface GatewaySession {
  sessionId: string;
  status: SessionStatus;
  agentType: string;
  title?: string;
  updatedAt: string;
}

export interface UseGatewayResult {
  connectionState: ConnectionState;
  sessions: GatewaySession[];
  selectedSessionId: string | null;
  selectedSessionEvents: ServerEvent[];
  selectSession: (sessionId: string | null) => void;
  sendInput: (sessionId: string, data: string) => void;
  stopSession: (sessionId: string) => void;
  refresh: () => void;
}

export function useGateway(): UseGatewayResult {
  const clientRef = useRef<BobWsClient | null>(null);
  const clientIdRef = useRef(uuid());

  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [sessions, setSessions] = useState<GatewaySession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSessionEvents, setSelectedSessionEvents] = useState<ServerEvent[]>([]);

  // Track which session is selected in a ref so callbacks don't go stale
  const selectedRef = useRef<string | null>(null);

  const selectSession = useCallback((sessionId: string | null) => {
    const prev = selectedRef.current;
    selectedRef.current = sessionId;
    setSelectedSessionId(sessionId);
    setSelectedSessionEvents([]);

    const client = clientRef.current;
    if (!client) return;

    // Unsubscribe from previous session's event stream
    if (prev) client.unsubscribe(prev);
    // Subscribe to new session's event stream
    if (sessionId) client.subscribe(sessionId);
  }, []);

  const sendInput = useCallback((sessionId: string, data: string) => {
    clientRef.current?.sendInput(sessionId, data);
  }, []);

  const stopSession = useCallback((sessionId: string) => {
    clientRef.current?.stopSession(sessionId);
  }, []);

  const refresh = useCallback(() => {
    // Re-subscribe to workspace to get a fresh snapshot
    const client = clientRef.current;
    if (client) {
      client.unsubscribeWorkspace();
      client.subscribeWorkspace();
    }
  }, []);

  useEffect(() => {
    const cookies = authClient.getCookie();
    if (!cookies) return;

    // Extract a token from cookies for the gateway hello handshake.
    // The gateway authenticates via the same session cookie the API uses.
    const token = cookies;

    const client = new BobWsClient({
      url: getGatewayWsUrl(),
      token,
      clientId: clientIdRef.current,
      deviceType: Platform.OS as "ios" | "android" | "web",
      onConnectionStateChange: setConnectionState,
      onWorkspaceSnapshot: (snapshot: WorkspaceSessionInfo[]) => {
        setSessions(
          snapshot.map((s) => ({
            sessionId: s.sessionId,
            status: s.status,
            agentType: s.agentType,
            title: s.title,
            updatedAt: s.updatedAt,
          })),
        );
      },
      onSessionStatusChanged: (info: ServerSessionStatusChanged) => {
        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.sessionId === info.sessionId);
          const updated: GatewaySession = {
            sessionId: info.sessionId,
            status: info.status,
            agentType: info.agentType,
            title: info.title,
            updatedAt: new Date().toISOString(),
          };
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = updated;
            return next;
          }
          return [updated, ...prev];
        });
      },
      onEvent: (_sessionId: string, event: ServerEvent) => {
        if (_sessionId === selectedRef.current) {
          setSelectedSessionEvents((prev) => [...prev, event]);
        }
      },
      onSessionStatus: (_sessionId: string, _status: SessionStatus) => {
        // Individual session status — update in the sessions list
        setSessions((prev) =>
          prev.map((s) =>
            s.sessionId === _sessionId ? { ...s, status: _status } : s,
          ),
        );
      },
      onError: (error: ServerError) => {
        console.warn("[Gateway] Error:", error.code, error.message);
      },
    });

    clientRef.current = client;
    // Register workspace subscription before connecting.
    // BobWsClient.send() is a no-op when not connected, but this sets
    // the internal workspaceSub so that resubscribeAll() on hello_ok
    // will send subscribe_workspace automatically.
    client.subscribeWorkspace();
    client.connect();

    return () => {
      clientRef.current = null;
      client.disconnect();
    };
  }, []);

  return {
    connectionState,
    sessions,
    selectedSessionId,
    selectedSessionEvents,
    selectSession,
    sendInput,
    stopSession,
    refresh,
  };
}
