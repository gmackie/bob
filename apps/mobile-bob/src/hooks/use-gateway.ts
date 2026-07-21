import Constants from "expo-constants";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
function randomId() {
  const hex = "0123456789abcdef";
  let id = "";
  for (let i = 0; i < 32; i++) id += hex[Math.floor(Math.random() * 16)];
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

import type {
  ConnectionState,
  ServerError,
  ServerEvent,
  ServerSessionStatusChanged,
  SessionStatus,
  WorkspaceSessionInfo,
} from "@bob/ws";
import { BobWsClient } from "@bob/ws";

import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";
import { mergeGatewaySessionStatusChange } from "./gateway-sessions";
import { invalidateGatewayEventQueries } from "./gateway-query-invalidations";
import { useSelectedWorkspace } from "./use-selected-workspace";
import {
  trackAgentSelected,
  trackWorkItemSelected,
  trackPlanningSessionOpened,
  trackAgentAction,
  trackConnectionStateChanged,
  trackTabletSessionStart,
  trackTabletSessionEnd,
} from "~/lib/tablet-analytics";

// Re-export for convenience
const useSession = authClient.useSession;

function getExpoExtraString(key: string): string | undefined {
  const extra: unknown = Constants.expoConfig?.extra;
  if (!extra || typeof extra !== "object") return undefined;

  const value = (extra as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getProcessEnvString(key: string): string | undefined {
  const value = process.env[key] as unknown;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getGatewayWsUrl(): string {
  // Full URL override (production: wss://ws.blder.bot/sessions)
  const explicitUrl =
    getExpoExtraString("GATEWAY_PUBLIC_URL") ??
    getProcessEnvString("EXPO_PUBLIC_GATEWAY_URL");
  if (explicitUrl) {
    return explicitUrl.endsWith("/sessions") ? explicitUrl : `${explicitUrl}/sessions`;
  }

  // Development fallback: derive from API URL
  const apiUrl = getBaseUrl();
  const parsed = new URL(apiUrl);
  const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  const port = getProcessEnvString("EXPO_PUBLIC_GATEWAY_PORT") ?? "3002";
  return `${protocol}//${parsed.hostname}:${port}/sessions`;
}

export interface GatewaySession {
  sessionId: string;
  status: SessionStatus;
  agentType: string;
  sessionType?: string | null;
  title?: string;
  lastActivityAt: string;
  workItemId?: string | null;
  workItemIdentifier?: string | null;
  draftCount?: number | null;
  producedTaskCount?: number | null;
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
  approve: (
    sessionId: string,
    requestId: string,
    decision: "allow" | "deny",
    message?: string,
  ) => void;
  reportRunView: (sessionId: string) => void;
  refresh: () => void;
}

export function useGateway(): UseGatewayResult {
  const clientRef = useRef<BobWsClient | null>(null);
  const clientIdRef = useRef(randomId());
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { selectedWorkspaceId } = useSelectedWorkspace();

  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [sessions, setSessions] = useState<GatewaySession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSessionEvents, setSelectedSessionEvents] = useState<ServerEvent[]>([]);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [activePlanningSessionId, setActivePlanningSessionId] = useState<string | null>(null);

  // Track which session is selected in a ref so callbacks don't go stale
  const selectedRef = useRef<string | null>(null);

  const selectSession = useCallback((sessionId: string | null) => {
    if (sessionId) trackAgentSelected(sessionId, "selected");
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
    if (workItemId) trackWorkItemSelected(workItemId);
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
    trackPlanningSessionOpened(sessionId);
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
    trackAgentAction("send_input");
    clientRef.current?.sendInput(sessionId, data);
  }, []);

  const stopSession = useCallback((sessionId: string) => {
    trackAgentAction("stop");
    clientRef.current?.stopSession(sessionId);
  }, []);

  const approve = useCallback(
    (sessionId: string, requestId: string, decision: "allow" | "deny", message?: string) => {
      trackAgentAction(decision === "allow" ? "approve" : "reject");
      clientRef.current?.approve(sessionId, requestId, decision, message);
    },
    [],
  );

  const reportRunView = useCallback((sessionId: string) => {
    clientRef.current?.runView(sessionId);
  }, []);

  const refresh = useCallback(() => {
    // Re-subscribe to workspace to get a fresh snapshot
    const client = clientRef.current;
    if (client) {
      client.unsubscribeWorkspace();
      client.subscribeWorkspace(undefined, selectedWorkspaceId ?? undefined);
    }
  }, [selectedWorkspaceId]);

  const invalidateLiveQueries = useCallback((messageType: string) => {
    invalidateGatewayEventQueries(queryClient, messageType);
  }, [queryClient]);

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
      onConnectionStateChange: (state) => {
        setConnectionState(state);
        trackConnectionStateChanged(state);
        if (state === "connected") trackTabletSessionStart();
      },
      onWorkspaceSnapshot: (snapshot: WorkspaceSessionInfo[]) => {
        setSessions(
          snapshot.map((s) => ({
            sessionId: s.sessionId,
            status: s.status,
            agentType: s.agentType,
            sessionType: s.sessionType,
            title: s.title,
            lastActivityAt: s.lastActivityAt,
            workItemId: s.workItemId,
            workItemIdentifier: s.workItemIdentifier,
            draftCount: s.draftCount,
            producedTaskCount: s.producedTaskCount,
          })),
        );
        invalidateLiveQueries("workspace_snapshot");
      },
      onSessionStatusChanged: (info: ServerSessionStatusChanged) => {
        setSessions((prev) => mergeGatewaySessionStatusChange(prev, info));
        invalidateLiveQueries("session_status_changed");
      },
      onWorkspaceEvent: (message) => {
        invalidateLiveQueries(message.type);
      },
      onEvent: (_sessionId: string, event: ServerEvent) => {
        if (_sessionId === selectedRef.current) {
          setSelectedSessionEvents((prev) => [...prev, event]);
        }
        invalidateLiveQueries("session_event_appended");
      },
      onSessionStatus: (_sessionId: string, _status: SessionStatus) => {
        // Individual session status — update in the sessions list
        setSessions((prev) =>
          prev.map((s) =>
            s.sessionId === _sessionId ? { ...s, status: _status } : s,
          ),
        );
        invalidateLiveQueries("session_status_changed");
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
    client.subscribeWorkspace(undefined, selectedWorkspaceId ?? undefined);
    client.connect();

    return () => {
      clientRef.current = null;
      trackTabletSessionEnd();
      client.disconnect();
    };
    // Reconnect when user session changes (login/logout)
  }, [session?.user.id, invalidateLiveQueries, selectedWorkspaceId]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;

    setSessions([]);
    client.unsubscribeWorkspace();
    client.subscribeWorkspace(undefined, selectedWorkspaceId ?? undefined);
  }, [selectedWorkspaceId]);

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
    approve,
    reportRunView,
    refresh,
  };
}
