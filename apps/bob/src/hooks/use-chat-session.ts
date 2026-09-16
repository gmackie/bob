"use client";

import { timestampString } from "~/rpc/timestamp";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SessionEvent, SessionStatus } from "~/hooks/use-session-socket";
import { useSessionSocket } from "~/hooks/use-session-socket";
import { useBobQueryClient } from "~/rpc/react";

// --- Converters ---

function toSessionStatus(status: string): SessionStatus {
  return [
    "provisioning",
    "starting",
    "running",
    "blocked",
    "idle",
    "stopping",
    "stopped",
    "completed",
    "failed",
    "error",
    "interrupted",
    "host_unknown",
  ].includes(status)
    ? (status as SessionStatus)
    : "stopped";
}

function toEventType(eventType: string): SessionEvent["eventType"] {
  return [
    "output_chunk",
    "message_final",
    "input",
    "tool_call",
    "tool_result",
    "state",
    "error",
    "heartbeat",
    "transcript",
    "permission_request",
    "permission_resolved",
    "status_change",
    "gap_marker",
  ].includes(eventType)
    ? (eventType as SessionEvent["eventType"])
    : "error";
}

function toEventDirection(direction: string): SessionEvent["direction"] {
  return ["client", "agent", "system"].includes(direction)
    ? (direction as SessionEvent["direction"])
    : "system";
}

type SessionEventRecord =
  import("@gmacko/bob-client/query").BobRpcOutput<"agent.session.getEvents">["events"][number];

function toSessionEvents(
  records?: readonly SessionEventRecord[],
): SessionEvent[] {
  return (records ?? []).map((e) => ({
    type: "event",
    sessionId: e.sessionId,
    seq: e.seq,
    eventType: toEventType(e.eventType),
    direction: toEventDirection(e.direction),
    payload: e.payload,
    createdAt: timestampString(e.createdAt),
  }));
}

// --- Hook ---

export interface WorkflowState {
  workflowStatus: string;
  statusMessage: string | null;
  awaitingInput: {
    question: string;
    options: string[] | null;
    defaultAction: string;
    expiresAt: string;
  } | null;
}

interface UseChatSessionOptions {
  sessionId: string | null;
  enabled?: boolean;
}

export function useChatSession({
  sessionId,
  enabled = true,
}: UseChatSessionOptions) {
  const bobQuery = useBobQueryClient();
  const queryClient = useQueryClient();
  const hasSession = Boolean(sessionId) && enabled;
  const activeId = sessionId ?? "";

  const [liveEvents, setLiveEvents] = useState<SessionEvent[]>([]);
  const [socketSessionStatus, setSocketSessionStatus] =
    useState<SessionStatus | null>(null);
  const latestSeqRef = useRef(0);

  // Gateway info
  const { data: gatewayInfo } = useQuery(
    bobQuery("agent.session.getGatewayWebSocketUrl").queryOptions(undefined, {
      enabled: hasSession,
    }),
  );

  // Session data
  const { data: sessionData } = useQuery(
    bobQuery("agent.session.get").queryOptions(
      { id: activeId },
      { enabled: hasSession },
    ),
  );

  // Events
  const { data: rawEvents } = useQuery(
    bobQuery("agent.session.getEvents").queryOptions(
      { sessionId: activeId, limit: 500 },
      { enabled: hasSession },
    ),
  );

  // Workflow state
  const { data: rawWorkflowState } = useQuery(
    bobQuery("agent.session.getWorkflowState").queryOptions(
      { sessionId: activeId },
      { enabled: hasSession },
    ),
  );

  const workflowState = useMemo<WorkflowState | null>(() => {
    if (!rawWorkflowState) return null;
    const ai = rawWorkflowState.awaitingInput;
    if (!ai) {
      return {
        workflowStatus: rawWorkflowState.workflowStatus,
        statusMessage: rawWorkflowState.statusMessage,
        awaitingInput: null,
      };
    }
    const expiresAt =
      typeof ai.expiresAt === "string"
        ? ai.expiresAt
        : ai.expiresAt instanceof Date
          ? ai.expiresAt.toISOString()
          : "";
    return {
      workflowStatus: rawWorkflowState.workflowStatus,
      statusMessage: rawWorkflowState.statusMessage,
      awaitingInput: {
        ...ai,
        options: ai.options ? [...ai.options] : null,
        expiresAt,
      },
    };
  }, [rawWorkflowState]);

  // Event merging
  const historicalEvents = useMemo(
    () => toSessionEvents(rawEvents?.events),
    [rawEvents?.events],
  );

  const events = useMemo(() => {
    const byKey = new Map<string, SessionEvent>();
    for (const e of historicalEvents) byKey.set(`${e.sessionId}:${e.seq}`, e);
    for (const e of liveEvents) {
      if (e.sessionId === activeId) byKey.set(`${e.sessionId}:${e.seq}`, e);
    }
    return [...byKey.values()].sort((a, b) => a.seq - b.seq);
  }, [historicalEvents, liveEvents, activeId]);

  useEffect(() => {
    latestSeqRef.current = events.at(-1)?.seq ?? 0;
  }, [events]);

  // Reset on session change
  useEffect(() => {
    setLiveEvents([]);
    setSocketSessionStatus(null);
  }, [activeId]);

  // WebSocket
  const handleEvent = useCallback(
    (event: SessionEvent) => {
      if (event.sessionId === activeId) {
        setLiveEvents((prev) => [...prev, event]);
      }
      if (
        event.eventType === "state" &&
        event.payload.workflowStatus &&
        event.sessionId === activeId
      ) {
        void queryClient.invalidateQueries({
          queryKey: bobQuery("agent.session.getWorkflowState").queryKey({
            sessionId: activeId,
          }),
        });
      }
    },
    [activeId, queryClient, bobQuery("agent.session.getWorkflowState")],
  );

  const handleStatusChange = useCallback(
    (sid: string, status: SessionStatus) => {
      if (sid === activeId) setSocketSessionStatus(status);
    },
    [activeId],
  );

  const {
    connectionState,
    subscribe,
    unsubscribe,
    sendInput,
    stopSession: wsStopSession,
    runView: wsRunView,
    reconnect,
  } = useSessionSocket({
    gatewayUrl: gatewayInfo?.url ?? "",
    token: gatewayInfo?.token ?? "",
    onEvent: handleEvent,
    onStatusChange: handleStatusChange,
    enabled: hasSession,
  });

  // Subscribe to session on connect
  useEffect(() => {
    if (!activeId || connectionState.status !== "connected") return;
    subscribe(activeId, latestSeqRef.current);
    return () => unsubscribe(activeId);
  }, [activeId, connectionState.status, subscribe, unsubscribe]);

  // Mutations
  const stopMutation = useMutation(
    bobQuery("agent.session.stop").mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: bobQuery("agent.session.get").queryKey({ id: activeId }),
        });
      },
    }),
  );

  const resolveInputMutation = useMutation(
    bobQuery("agent.session.resolveAwaitingInput").mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: bobQuery("agent.session.getWorkflowState").queryKey({
            sessionId: activeId,
          }),
        });
      },
    }),
  );

  // Actions
  const sendMessage = useCallback(
    (message: string) => {
      if (!activeId) return;
      sendInput(activeId, message);
    },
    [activeId, sendInput],
  );

  const stopSession = useCallback(() => {
    if (!activeId) return;
    wsStopSession(activeId);
  }, [activeId, wsStopSession]);

  const reportRunView = useCallback(() => {
    if (!activeId) return;
    wsRunView(activeId);
  }, [activeId, wsRunView]);

  const resolveInput = useCallback(
    (response: string) => {
      if (!activeId || !workflowState?.awaitingInput) return;
      resolveInputMutation.mutate({
        sessionId: activeId,
        resolution: { type: "human", value: response },
      });
    },
    [activeId, resolveInputMutation, workflowState],
  );

  const sessionStatus =
    socketSessionStatus ??
    (sessionData ? toSessionStatus(sessionData.status) : "stopped");

  const isConnected = connectionState.status === "connected";
  const canSend =
    isConnected && (sessionStatus === "running" || sessionStatus === "idle");

  return {
    events,
    connectionState,
    sendMessage,
    stopSession,
    reportRunView,
    resolveInput,
    isResolving: resolveInputMutation.isPending,
    workflowState,
    sessionData: hasSession ? sessionData : null,
    sessionStatus,
    isConnected,
    canSend,
    reconnect,
  };
}
