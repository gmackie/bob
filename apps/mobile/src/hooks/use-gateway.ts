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

// Re-export for convenience
const useSession = authClient.useSession;

function getGatewayWsUrl(): string {
  // Full URL override (production: wss://ws.blder.bot/sessions)
  const explicitUrl = process.env.EXPO_PUBLIC_GATEWAY_URL;
  if (explicitUrl) {
    return explicitUrl.endsWith("/sessions") ? explicitUrl : `${explicitUrl}/sessions`;
  }

  // Development fallback: derive from API URL
  const apiUrl = getBaseUrl();
  const parsed = new URL(apiUrl);
  const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  const port = process.env.EXPO_PUBLIC_GATEWAY_PORT ?? "3002";
  return `${protocol}//${parsed.hostname}:${port}/sessions`;
}

export interface GatewaySession {
  sessionId: string;
  status: SessionStatus;
  agentType: string;
  title?: string;
  lastActivityAt: string;
}

export interface UseGatewayResult {
  connectionState: ConnectionState;
  sessions: GatewaySession[];
  selectedSessionId: string | null;
  selectedSessionEvents: ServerEvent[];
  selectedWorkItemId: string | null;
  activePlanningSessionId: string | null;
  selectSession: (sessionId: string | null) => void;
  selectWorkItem: (workItemId: string | null) => void;
  openPlanningSession: (sessionId: string) => void;
  sendInput: (sessionId: string, data: string) => void;
  stopSession: (sessionId: string) => void;
  refresh: () => void;
}

export function useGateway(): UseGatewayResult {
  const clientRef = useRef<BobWsClient | null>(null);
  const clientIdRef = useRef(uuid());
  const { data: session } = useSession();

  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [sessions, setSessions] = useState<GatewaySession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSessionEvents, setSelectedSessionEvents] = useState<ServerEvent[]>([]);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [activePlanningSessionId, setActivePlanningSessionId] = useState<string | null>(null);

  // Track which session is selected in a ref so callbacks don't go stale
  const selectedRef = useRef<string | null>(null);

  const selectSession = useCallback((sessionId: string | null) => {
    const prev = selectedRef.current;
    selectedRef.current = sessionId;
    setSelectedSessionId(sessionId);
    setSelectedSessionEvents([]);
    setActivePlanningSessionId(null);
    if (sessionId) setSelectedWorkItemId(null);

    const client = clientRef.current;
    if (!client) return;

    if (prev) client.unsubscribe(prev);
    // observe: true — monitoring only, don't auto-start the agent
    if (sessionId) client.subscribe(sessionId, 0, true);
  }, []);

  const selectWorkItem = useCallback((workItemId: string | null) => {
    setSelectedWorkItemId(workItemId);
    setActivePlanningSessionId(null);
    if (workItemId) {
      const prev = selectedRef.current;
      if (prev) clientRef.current?.unsubscribe(prev);
      selectedRef.current = null;
      setSelectedSessionId(null);
      setSelectedSessionEvents([]);
    }
  }, []);

  const openPlanningSession = useCallback((sessionId: string) => {
    // Subscribe to this planning session's event stream
    const prev = selectedRef.current;
    selectedRef.current = sessionId;
    setSelectedSessionId(sessionId);
    setSelectedSessionEvents([]);
    setActivePlanningSessionId(sessionId);

    const client = clientRef.current;
    if (!client) return;

    if (prev) client.unsubscribe(prev);
    client.subscribe(sessionId);
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
            lastActivityAt: s.lastActivityAt,
          })),
        );
      },
      onSessionStatusChanged: (info: ServerSessionStatusChanged) => {
        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.sessionId === info.sessionId);
          if (idx >= 0) {
            // Merge — preserve existing title if the update doesn't include one
            const existing = prev[idx]!;
            const next = [...prev];
            next[idx] = {
              ...existing,
              status: info.status,
              agentType: info.agentType ?? existing.agentType,
              title: info.title ?? existing.title,
              lastActivityAt: new Date().toISOString(),
            };
            return next;
          }
          // New session not yet in snapshot — add it
          return [{
            sessionId: info.sessionId,
            status: info.status,
            agentType: info.agentType ?? "unknown",
            title: info.title,
            lastActivityAt: new Date().toISOString(),
          }, ...prev];
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
    // Reconnect when user session changes (login/logout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  return {
    connectionState,
    sessions,
    selectedSessionId,
    selectedSessionEvents,
    selectSession,
    selectedWorkItemId,
    activePlanningSessionId,
    selectWorkItem,
    openPlanningSession,
    sendInput,
    stopSession,
    refresh,
  };
}
