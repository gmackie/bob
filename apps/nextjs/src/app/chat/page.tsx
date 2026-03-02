"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SessionEvent, SessionStatus } from "~/hooks/use-session-socket";
import { useSessionSocket } from "~/hooks/use-session-socket";
import { useVoiceSession } from "~/hooks/use-voice-session";
import { useTRPC } from "~/trpc/react";
import { InputComposer } from "./_components/input-composer";
import { AwaitingInputCard } from "./_components/awaiting-input-card";
import { MessageStream } from "./_components/message-stream";
import {
  ConnectionIndicator,
  SessionHeader,
} from "./_components/session-header";
import { SessionList } from "./_components/session-list";
import { WorkspacePanel } from "./_components/workspace-panel";

import "./chat.css";

interface SessionEventRecord {
  sessionId: string;
  seq: number;
  eventType: string;
  direction: string;
  payload: Record<string, unknown>;
  createdAt: string | Date;
}

interface SessionEventsResponse {
  events: SessionEventRecord[];
}

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

function toSessionEvents(records?: SessionEventsResponse["events"]): SessionEvent[] {
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

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatPageSkeleton />}>
      <ChatPageContent />
    </Suspense>
  );
}

function ChatPageSkeleton() {
  return (
    <div className="chat-root">
      <div className="chat-shell">
        <div className="chat-sidebar">
          <div className="chat-sidebarHeader">
            <div className="h-8 w-20 animate-pulse rounded bg-white/10" />
          </div>
          <div className="chat-emptyText">Loading sessions…</div>
        </div>

        <div className="chat-main">
          <div className="chat-emptyState chat-emptyText">
            <div className="chat-emptyStateTitle">Loading workspace…</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatEmptyState() {
  return (
    <div className="chat-emptyState">
      <div>
        <div className="chat-emptyStateTitle">Select a session</div>
        <div className="chat-emptyStateSubtext">
          Choose a session from the sidebar or create one to begin
        </div>
      </div>
    </div>
  );
}

function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const sessionId = searchParams.get("session");
  const hasSessionId = Boolean(sessionId);
  const activeSessionId = sessionId ?? "";
  const [liveEvents, setLiveEvents] = useState<SessionEvent[]>([]);
  const [socketSessionStatus, setSocketSessionStatus] = useState<SessionStatus | null>(
    null,
  );
  const latestSeqRef = useRef(0);

  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(),
  );

  const { data: rawSessionData } = useQuery(
    trpc.session.get.queryOptions({ id: activeSessionId }, { enabled: hasSessionId }),
  );

  const activeSessionData = hasSessionId ? rawSessionData : null;

  const { data: rawSessionEvents } = useQuery(
    trpc.session.getEvents.queryOptions(
      { sessionId: activeSessionId, limit: 500 },
      { enabled: hasSessionId },
    ),
  );
  const { data: rawWorkflowState } = useQuery(
    trpc.session.getWorkflowState.queryOptions(
      { sessionId: activeSessionId },
      { enabled: hasSessionId },
    ),
  );

  const workflowState = useMemo(() => {
    if (!rawWorkflowState) return null;

    if (!rawWorkflowState.awaitingInput) return rawWorkflowState;

    return {
      ...rawWorkflowState,
      awaitingInput: {
        ...rawWorkflowState.awaitingInput,
        expiresAt:
          typeof rawWorkflowState.awaitingInput.expiresAt === "string"
            ? rawWorkflowState.awaitingInput.expiresAt
            : new Date(rawWorkflowState.awaitingInput.expiresAt).toISOString(),
      },
    };
  }, [rawWorkflowState]);

  const resolveAwaitingInputMutation = useMutation(
    trpc.session.resolveAwaitingInput.mutationOptions({
      onSuccess: () => {
        if (!hasSessionId) return;
        void queryClient.invalidateQueries({
          queryKey: trpc.session.getWorkflowState.queryKey({
            sessionId: activeSessionId,
          }),
        });
      },
      onError: (error) => {
        console.error("[ChatPage] Failed to resolve awaiting input:", error);
      },
    }),
  );

  const historicalEvents = useMemo(
    () => toSessionEvents(rawSessionEvents?.events),
    [rawSessionEvents?.events],
  );
  const liveEventsForSession = useMemo(
    () => (activeSessionId ? liveEvents.filter((event) => event.sessionId === activeSessionId) : []),
    [activeSessionId, liveEvents],
  );
  const events = useMemo(() => {
    const eventsBySeq = new Map<string, SessionEvent>();

    for (const event of historicalEvents) {
      eventsBySeq.set(`${event.sessionId}:${event.seq}`, event);
    }

    for (const event of liveEventsForSession) {
      eventsBySeq.set(`${event.sessionId}:${event.seq}`, event);
    }

    return [...eventsBySeq.values()].sort((a, b) => a.seq - b.seq);
  }, [historicalEvents, liveEventsForSession]);

  useEffect(() => {
    latestSeqRef.current = activeSessionId
      ? events.at(-1)?.seq ?? 0
      : 0;
  }, [activeSessionId, events]);

  const handleEvent = useCallback(
    (event: SessionEvent) => {
      if (event.sessionId === activeSessionId) {
        setLiveEvents((prev) => [...prev, event]);
        if (event.eventType === "state" && event.payload.workflowStatus) {
          void queryClient.invalidateQueries({
            queryKey: trpc.session.getWorkflowState.queryKey({
              sessionId: activeSessionId,
            }),
          });
        }
      }
    },
    [activeSessionId, queryClient, setLiveEvents, trpc.session.getWorkflowState],
  );

  const handleStatusChange = useCallback(
    (sid: string, status: SessionStatus) => {
      if (sid === activeSessionId) {
        setSocketSessionStatus(status);
      }
    },
    [activeSessionId, setSocketSessionStatus],
  );

  const {
    connectionState,
    subscribe,
    unsubscribe,
    sendInput,
    stopSession,
    reconnect,
  } = useSessionSocket({
    gatewayUrl: gatewayInfo?.url ?? "",
    token: "session-token",
    onEvent: handleEvent,
    onStatusChange: handleStatusChange,
  });

  useEffect(() => {
    if (activeSessionId && connectionState.status === "connected") {
      subscribe(activeSessionId, latestSeqRef.current);
      return () => unsubscribe(activeSessionId);
    }
  }, [activeSessionId, connectionState.status, subscribe, unsubscribe]);

  const handleSelectSession = useCallback(
    (id: string) => {
      setLiveEvents([]);
      latestSeqRef.current = 0;
      setSocketSessionStatus(null);
      router.push(`/chat?session=${id}`);
    },
    [router, setLiveEvents, setSocketSessionStatus],
  );

  const handleSendMessage = useCallback(
    (message: string) => {
      if (!sessionId) return;
      sendInput(sessionId, message);
    },
    [sessionId, sendInput],
  );

  const handleWorkspaceCommand = useCallback(
    (command: string) => {
      if (!sessionId) return;
      sendInput(sessionId, command);
    },
    [sendInput, sessionId],
  );

  const handleStopSession = useCallback(() => {
    if (!sessionId) return;
    stopSession(sessionId);
  }, [sessionId, stopSession]);

  const handleResolveWorkflowInput = useCallback(
    (response: string) => {
      if (!sessionId || !workflowState?.awaitingInput) return;

      resolveAwaitingInputMutation.mutate({
        sessionId: activeSessionId,
        resolution: {
          type: "human",
          value: response,
        },
      });
    },
    [activeSessionId, resolveAwaitingInputMutation, sessionId, workflowState],
  );

  const isConnected = connectionState.status === "connected";
  const sessionStatus =
    socketSessionStatus ??
    (activeSessionData ? toSessionStatus(activeSessionData.status) : "stopped");
  const canSend = isConnected && (sessionStatus === "running" || sessionStatus === "idle");
  const isAwaitingInput = workflowState?.workflowStatus === "awaiting_input";

  // Get voice status for ElevenLabs sessions
  const { state: voiceState } = useVoiceSession(
    sessionId ?? null,
    activeSessionData?.agentType,
  );

  return (
    <div className="chat-root">
      <div className="chat-shell">
        <SessionList
          selectedId={sessionId ?? undefined}
          onSelect={handleSelectSession}
        />

        <div className="chat-main">
          <ConnectionIndicator
            status={connectionState.status}
            error={connectionState.error}
            reconnectAttempt={connectionState.reconnectAttempt}
            reconnectIn={connectionState.reconnectIn}
            onReconnect={reconnect}
          />

          {sessionId && activeSessionData ? (
            <>
              <SessionHeader
                title={
                  activeSessionData.title ??
                  `Session ${activeSessionData.id.slice(0, 8)}`
                }
                status={sessionStatus}
                agentType={activeSessionData.agentType}
                workingDirectory={activeSessionData.workingDirectory ?? undefined}
                voiceStatus={
                  activeSessionData.agentType === "elevenlabs"
                    ? voiceState.status
                    : undefined
                }
                workflowState={workflowState}
                onStop={handleStopSession}
              />

              <div className="chat-mainLayout">
                <div className="chat-mainWorkspaceArea">
                  {workflowState?.awaitingInput ? (
                    <div className="chat-workspacePanel">
                      <AwaitingInputCard
                        question={workflowState.awaitingInput.question}
                        options={workflowState.awaitingInput.options}
                        defaultAction={workflowState.awaitingInput.defaultAction}
                        expiresAt={workflowState.awaitingInput.expiresAt as string}
                        onResolve={handleResolveWorkflowInput}
                        isResolving={resolveAwaitingInputMutation.isPending}
                      />
                    </div>
                  ) : null}

                  <MessageStream
                    sessionId={sessionId}
                    events={events}
                    isConnected={isConnected}
                  />
                </div>

                {activeSessionData.workingDirectory ? (
                  <WorkspacePanel
                    key={`${activeSessionId}-${activeSessionData.workingDirectory}`}
                    sessionId={sessionId}
                    workingDirectory={activeSessionData.workingDirectory}
                    canSendCommands={canSend}
                    onSendCommand={handleWorkspaceCommand}
                  />
                ) : null}
              </div>

              <InputComposer
                onSend={handleSendMessage}
                disabled={!canSend || isAwaitingInput}
                agentType={activeSessionData.agentType}
                sessionId={sessionId}
                placeholder={
                  isAwaitingInput
                    ? "Please resolve the input prompt above"
                    : !isConnected
                      ? "Connecting..."
                      : sessionStatus === "stopped"
                        ? "Session stopped"
                        : sessionStatus === "error"
                          ? "Session error"
                          : "Type a message..."
                }
              />
            </>
          ) : (
            <ChatEmptyState />
          )}
        </div>
      </div>
    </div>
  );
}
