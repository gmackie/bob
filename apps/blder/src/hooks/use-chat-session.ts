"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SessionEvent, SessionStatus } from "~/hooks/use-session-socket";
import { useSessionSocket } from "~/hooks/use-session-socket";
import { useTRPC } from "~/trpc/react";

// --- Converters ---

function toSessionStatus(status: string): SessionStatus {
  return [
    "provisioning",
    "starting",
    "running",
    "idle",
    "stopping",
    "stopped",
    "error",
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
  ].includes(eventType)
    ? (eventType as SessionEvent["eventType"])
    : "error";
}

function toEventDirection(direction: string): SessionEvent["direction"] {
  return ["client", "agent", "system"].includes(direction)
    ? (direction as SessionEvent["direction"])
    : "system";
}

interface SessionEventRecord {
  sessionId: string;
  seq: number;
  eventType: string;
  direction: string;
  payload: Record<string, unknown>;
  createdAt: string | Date;
}

function toSessionEvents(records?: SessionEventRecord[]): SessionEvent[] {
  return (records ?? []).map((e) => ({
    type: "event",
    sessionId: e.sessionId,
    seq: e.seq,
    eventType: toEventType(e.eventType),
    direction: toEventDirection(e.direction),
    payload: e.payload,
    createdAt:
      typeof e.createdAt === "string" ? e.createdAt : e.createdAt.toISOString(),
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

export function useChatSession({ sessionId, enabled = true }: UseChatSessionOptions) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const hasSession = Boolean(sessionId) && enabled;
  const activeId = sessionId ?? "";

  const [liveEvents, setLiveEvents] = useState<SessionEvent[]>([]);
  const [socketSessionStatus, setSocketSessionStatus] =
    useState<SessionStatus | null>(null);
  const latestSeqRef = useRef(0);

  // Gateway info
  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(undefined, {
      enabled: hasSession,
    }),
  );

  // Session data
  const { data: sessionData } = useQuery(
    trpc.session.get.queryOptions({ id: activeId }, { enabled: hasSession }),
  );

  // Events
  const { data: rawEvents } = useQuery(
    trpc.session.getEvents.queryOptions(
      { sessionId: activeId, limit: 500 },
      { enabled: hasSession },
    ),
  );

  // Workflow state
  const { data: rawWorkflowState } = useQuery(
    trpc.session.getWorkflowState.queryOptions(
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
      awaitingInput: { ...ai, expiresAt },
    };
  }, [rawWorkflowState]);

  // Event merging
  const historicalEvents = useMemo(
    () => toSessionEvents(rawEvents?.events as SessionEventRecord[] | undefined),
    [rawEvents?.events],
  );

  const events = useMemo(() => {
    const byKey = new Map<string, SessionEvent>();
    for (const e of historicalEvents) byKey.set(`${e.sessionId}:${e.seq}`, e);
    for (const e of liveEvents) {
      if (e.sessionId === activeId)
        byKey.set(`${e.sessionId}:${e.seq}`, e);
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
          queryKey: trpc.session.getWorkflowState.queryKey({
            sessionId: activeId,
          }),
        });
      }
    },
    [activeId, queryClient, trpc.session.getWorkflowState],
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
    trpc.session.stop.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.session.get.queryKey({ id: activeId }),
        });
      },
    }),
  );

  const resolveInputMutation = useMutation(
    trpc.session.resolveAwaitingInput.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.session.getWorkflowState.queryKey({
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
    isConnected &&
    (sessionStatus === "running" || sessionStatus === "idle");

  return {
    events,
    connectionState,
    sendMessage,
    stopSession,
    resolveInput,
    workflowState,
    sessionData: hasSession ? sessionData : null,
    sessionStatus,
    isConnected,
    canSend,
    reconnect,
  };
}
