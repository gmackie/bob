"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@bob/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SessionEvent, SessionStatus } from "~/hooks/use-session-socket";
import { useSessionSocket } from "~/hooks/use-session-socket";
import { useVoiceSession } from "~/hooks/use-voice-session";
import { useTRPC } from "~/trpc/react";
import { AwaitingInputCard } from "./_components/awaiting-input-card";
import { InputComposer } from "./_components/input-composer";
import { MessageStream } from "./_components/message-stream";
import {
  ConnectionIndicator,
  type WorkflowState,
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

type InteractionMode = "web" | "headless";

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

function buildChatPath(
  baseSearch: URLSearchParams,
  mode: InteractionMode,
  sessionId?: string,
): string {
  const params = new URLSearchParams(baseSearch.toString());
  params.set("mode", mode);

  if (sessionId) {
    params.set("session", sessionId);
  }

  return params.toString().length > 0 ? `/chat?${params.toString()}` : "/chat";
}

export default function ChatPage() {
  // Redirect to planning if accessed directly without a session context.
  // Chat is now accessed through the ChatPanel on task detail pages.
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasSession = searchParams?.get("session");

  useEffect(() => {
    if (!hasSession) {
      router.replace("/planning");
    }
  }, [hasSession, router]);

  if (!hasSession) {
    return <ChatPageSkeleton />;
  }

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
            <div className="h-8 w-20 animate-pulse rounded bg-accent" />
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

const EMPTY_SEARCH_PARAMS = new URLSearchParams();

function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = searchParams ?? EMPTY_SEARCH_PARAMS;
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const sessionId = params.get("session");
  const hasSessionId = Boolean(sessionId);
  const activeSessionId = sessionId ?? "";
  const [liveEvents, setLiveEvents] = useState<SessionEvent[]>([]);
  const [socketSessionStatus, setSocketSessionStatus] =
    useState<SessionStatus | null>(null);
  const startedSessionsRef = useRef(new Set<string>());
  const latestSeqRef = useRef(0);
  const [headlessFromSeq, setHeadlessFromSeq] = useState(0);

  const interactionMode = useMemo<InteractionMode>(() => {
    const mode = params.get("mode");
    return mode === "headless" ? "headless" : "web";
  }, [params]);
  const isHeadlessMode = interactionMode === "headless";

  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions(),
  );

  const { data: rawSessionData } = useQuery(
    trpc.session.get.queryOptions({ id: activeSessionId }, { enabled: hasSessionId }),
  );
  const activeSessionData = hasSessionId ? rawSessionData : null;

  const eventQueryInput = useMemo(
    () =>
      isHeadlessMode
        ? {
            sessionId: activeSessionId,
            fromSeq: headlessFromSeq,
            limit: 200,
          }
        : { sessionId: activeSessionId, limit: 500 },
    [activeSessionId, headlessFromSeq, isHeadlessMode],
  );

  const { data: rawSessionEvents, refetch: refetchSessionEvents } = useQuery(
    trpc.session.getEvents.queryOptions(
      eventQueryInput,
      {
        enabled: hasSessionId,
        refetchInterval: isHeadlessMode ? 1500 : false,
      },
    ),
  );

  const { data: rawWorkflowState } = useQuery(
    trpc.session.getWorkflowState.queryOptions(
      { sessionId: activeSessionId },
      { enabled: hasSessionId },
    ),
  );

  const workflowState = useMemo<WorkflowState | null>(() => {
    if (!rawWorkflowState) return null;

    const awaitingInput = rawWorkflowState.awaitingInput;
    if (!awaitingInput) {
      return {
        workflowStatus: rawWorkflowState.workflowStatus,
        statusMessage: rawWorkflowState.statusMessage,
        awaitingInput: null,
      };
    }

    const expiresAtValue = awaitingInput.expiresAt;
    const normalizedExpiresAt =
      typeof expiresAtValue === "string"
        ? expiresAtValue
        : expiresAtValue instanceof Date
          ? expiresAtValue.toISOString()
          : null;

    return {
      workflowStatus: rawWorkflowState.workflowStatus,
      statusMessage: rawWorkflowState.statusMessage,
      awaitingInput: {
        ...awaitingInput,
        expiresAt: normalizedExpiresAt ?? "",
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

  const stopSessionMutation = useMutation(
    trpc.session.stop.mutationOptions({
      onSuccess: () => {
        if (!hasSessionId) return;
        void queryClient.invalidateQueries({
          queryKey: trpc.session.get.queryKey({
            id: activeSessionId,
          }),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.session.getEvents.queryKey({
            sessionId: activeSessionId,
          }),
        });
      },
      onError: (error) => {
        console.error("[ChatPage] Failed to stop session:", error);
      },
    }),
  );

  const sendHeadlessInputMutation = useMutation(
    trpc.session.sendHeadlessInput.mutationOptions({
      onSuccess: () => {
        if (!hasSessionId) return;
        void queryClient.invalidateQueries({
          queryKey: trpc.session.get.queryKey({
            id: activeSessionId,
          }),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.session.getEvents.queryKey({
            sessionId: activeSessionId,
          }),
        });
        void refetchSessionEvents();
      },
      onError: (error) => {
        console.error("[ChatPage] Failed to send headless input:", error);
        void queryClient.invalidateQueries({
          queryKey: trpc.session.getEvents.queryKey({
            sessionId: activeSessionId,
          }),
        });
      },
    }),
  );

  const historicalEvents = useMemo(
    () => toSessionEvents(rawSessionEvents?.events),
    [rawSessionEvents?.events],
  );
  const liveEventsForSession = useMemo(
    () =>
      activeSessionId
        ? liveEvents.filter((event) => event.sessionId === activeSessionId)
        : [],
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
    latestSeqRef.current = activeSessionId ? events.at(-1)?.seq ?? 0 : 0;
  }, [activeSessionId, events]);

  useEffect(() => {
    setHeadlessFromSeq(0);
    setLiveEvents([]);
    setSocketSessionStatus(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (!isHeadlessMode || !rawSessionEvents) return;

    const nextSeq = rawSessionEvents.latestSeq;
    if (typeof nextSeq === "number" && nextSeq > headlessFromSeq) {
      setHeadlessFromSeq(nextSeq);
    }
  }, [headlessFromSeq, isHeadlessMode, rawSessionEvents?.latestSeq]);

  const handleEvent = useCallback(
    (event: SessionEvent) => {
      if (event.sessionId === activeSessionId) {
        setLiveEvents((prev) => [...prev, event]);
      }

      if (
        event.eventType === "state" &&
        event.payload.workflowStatus &&
        event.sessionId === activeSessionId
      ) {
        void queryClient.invalidateQueries({
          queryKey: trpc.session.getWorkflowState.queryKey({
            sessionId: activeSessionId,
          }),
        });
      }
    },
    [activeSessionId, queryClient, trpc.session.getWorkflowState],
  );

  const handleStatusChange = useCallback(
    (sid: string, status: SessionStatus) => {
      if (sid === activeSessionId) {
        setSocketSessionStatus(status);
      }
    },
    [activeSessionId],
  );

  const {
    connectionState,
    subscribe,
    unsubscribe,
    createSession,
    sendInput,
    stopSession,
    reconnect,
  } = useSessionSocket({
    gatewayUrl: gatewayInfo?.url ?? "",
    token: gatewayInfo?.userId ?? "session-token",
    onEvent: handleEvent,
    onStatusChange: handleStatusChange,
    enabled: true,
  });

  const updateUrl = useCallback(
    (mode: InteractionMode, selectedSessionId?: string) => {
      const nextPath = buildChatPath(
        new URLSearchParams(params.toString()),
        mode,
        selectedSessionId ?? activeSessionId,
      );
      router.push(nextPath);
    },
    [activeSessionId, params, router],
  );

  useEffect(() => {
    if (!activeSessionId || connectionState.status !== "connected") {
      return;
    }

    subscribe(activeSessionId, latestSeqRef.current);
    return () => unsubscribe(activeSessionId);
  }, [activeSessionId, connectionState.status, subscribe, unsubscribe]);

  useEffect(() => {
    if (
      isHeadlessMode ||
      connectionState.status !== "connected" ||
      !activeSessionData ||
      !sessionId
    ) {
      return;
    }

    if (["running", "idle"].includes(activeSessionData.status)) {
      startedSessionsRef.current.delete(sessionId);
      return;
    }

    if (startedSessionsRef.current.has(sessionId)) {
      return;
    }

    createSession({
      sessionId,
      workingDirectory: activeSessionData.workingDirectory ?? "/",
      agentType: activeSessionData.agentType,
      repositoryId: activeSessionData.repositoryId ?? undefined,
      worktreeId: activeSessionData.worktreeId ?? undefined,
      title: activeSessionData.title ?? undefined,
    });
    startedSessionsRef.current.add(sessionId);
  }, [
    activeSessionData,
    connectionState.status,
    createSession,
    isHeadlessMode,
    sessionId,
  ]);

  useEffect(() => {
    if (isHeadlessMode) return;
    if (connectionState.status !== "connected") {
      startedSessionsRef.current.clear();
    }
  }, [connectionState.status, isHeadlessMode]);

  const handleSelectMode = useCallback(
    (mode: InteractionMode) => {
      if (mode === interactionMode) return;

      const nextPath = buildChatPath(
        new URLSearchParams(params.toString()),
        mode,
        activeSessionId,
      );
      router.replace(nextPath);
    },
    [activeSessionId, interactionMode, params, router],
  );

  const handleSelectSession = useCallback(
    (id: string, mode: InteractionMode = interactionMode) => {
      setLiveEvents([]);
      latestSeqRef.current = 0;
      setSocketSessionStatus(null);
      updateUrl(mode, id);
    },
    [interactionMode, setLiveEvents, setSocketSessionStatus, updateUrl],
  );

  const sendMessageOrCommand = useCallback(
    (message: string) => {
      if (!activeSessionId) return;

      if (isHeadlessMode) {
        sendHeadlessInputMutation.mutate({
          sessionId: activeSessionId,
          message,
        });
        return;
      }

      sendInput(activeSessionId, message);
    },
    [activeSessionId, isHeadlessMode, sendHeadlessInputMutation, sendInput],
  );

  const handleSendMessage = useCallback(
    (message: string) => {
      sendMessageOrCommand(message);
    },
    [sendMessageOrCommand],
  );

  const handleWorkspaceCommand = useCallback(
    (command: string) => {
      sendMessageOrCommand(command);
    },
    [sendMessageOrCommand],
  );

  const handleStopSession = useCallback(() => {
    if (!activeSessionId) return;

    if (isHeadlessMode) {
      stopSessionMutation.mutate({ id: activeSessionId });
      return;
    }

    stopSession(activeSessionId);
  }, [activeSessionId, isHeadlessMode, stopSession, stopSessionMutation]);

  const handleResolveWorkflowInput = useCallback(
    (response: string) => {
      if (!activeSessionId || !workflowState?.awaitingInput) return;

      resolveAwaitingInputMutation.mutate({
        sessionId: activeSessionId,
        resolution: {
          type: "human",
          value: response,
        },
      });
    },
    [activeSessionId, resolveAwaitingInputMutation, workflowState],
  );

  const isConnected = !isHeadlessMode && connectionState.status === "connected";
  const sessionStatus =
    socketSessionStatus ??
    (activeSessionData ? toSessionStatus(activeSessionData.status) : "stopped");
  const canSend =
    (isHeadlessMode || isConnected) &&
    (sessionStatus === "running" || sessionStatus === "idle") &&
    !sendHeadlessInputMutation.isPending;
  const isAwaitingInput = workflowState?.workflowStatus === "awaiting_input";

  const { state: voiceState } = useVoiceSession(
    sessionId ?? null,
    activeSessionData?.agentType,
  );

  return (
    <div className="chat-root">
      <div className="chat-shell">
        <SessionList
          selectedId={sessionId ?? undefined}
          selectedMode={interactionMode}
          onSelect={handleSelectSession}
        />

        <div className="chat-main">
          <div className="chat-modeSwitch" role="tablist" aria-label="Interaction mode">
            <button
              type="button"
              role="tab"
              aria-selected={interactionMode === "web"}
              onClick={() => handleSelectMode("web")}
              className={cn("chat-modeSwitchButton", {
                "is-active": interactionMode === "web",
              })}
            >
              Web Terminal
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={interactionMode === "headless"}
              onClick={() => handleSelectMode("headless")}
              className={cn("chat-modeSwitchButton", {
                "is-active": interactionMode === "headless",
              })}
            >
              Headless Chat
            </button>
          </div>

          {isHeadlessMode ? (
            <div className="chat-connectionBar chat-connectionBar--connecting">
              Headless mode active
            </div>
          ) : (
            <ConnectionIndicator
              status={connectionState.status}
              error={connectionState.error}
              reconnectAttempt={connectionState.reconnectAttempt}
              reconnectIn={connectionState.reconnectIn}
              onReconnect={reconnect}
            />
          )}

          {sessionId && activeSessionData ? (
            <>
              <SessionHeader
                title={
                  activeSessionData.title ??
                  `Session ${activeSessionData.id.slice(0, 8)}`
                }
                status={sessionStatus}
                agentType={activeSessionData.agentType}
                issueManaged={activeSessionData.issueManaged}
                workingDirectory={activeSessionData.workingDirectory ?? undefined}
                gitBranch={activeSessionData.gitBranch ?? undefined}
                linkedTask={
                  activeSessionData.linkedTask
                    ? {
                        ...activeSessionData.linkedTask,
                        url: activeSessionData.linkedTask.url ?? undefined,
                      }
                    : null
                }
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
                    isConnected={isHeadlessMode ? true : isConnected}
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
                    : isHeadlessMode
                      ? "Type a message..."
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
