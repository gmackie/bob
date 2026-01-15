"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTRPC } from "~/trpc/react";
import { useQuery } from "@tanstack/react-query";
import { SessionList } from "./_components/session-list";
import { MessageStream } from "./_components/message-stream";
import { InputComposer } from "./_components/input-composer";
import { SessionHeader, ConnectionIndicator } from "./_components/session-header";
import { useSessionSocket, type SessionEvent, type SessionStatus } from "~/hooks/use-session-socket";

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const trpc = useTRPC();
  
  const sessionId = searchParams.get("session");
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("stopped");
  
  const { data: gatewayInfo } = useQuery(
    trpc.session.getGatewayWebSocketUrl.queryOptions()
  );

  const { data: sessionData } = useQuery(
    trpc.session.get.queryOptions(
      { id: sessionId! },
      { enabled: !!sessionId }
    )
  );

  const { data: sessionEvents } = useQuery(
    trpc.session.getEvents.queryOptions(
      { sessionId: sessionId!, limit: 500 },
      { enabled: !!sessionId }
    )
  );

  const handleEvent = useCallback((event: SessionEvent) => {
    if (event.sessionId === sessionId) {
      setEvents(prev => [...prev, event]);
    }
  }, [sessionId]);

  const handleStatusChange = useCallback((sid: string, status: SessionStatus) => {
    if (sid === sessionId) {
      setSessionStatus(status);
    }
  }, [sessionId]);

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
    if (sessionEvents?.events) {
      setEvents(sessionEvents.events.map(e => ({
        type: "event" as const,
        sessionId: e.sessionId,
        seq: e.seq,
        eventType: e.eventType as SessionEvent["eventType"],
        direction: e.direction as SessionEvent["direction"],
        payload: e.payload,
        createdAt: e.createdAt.toISOString(),
      })));
    }
  }, [sessionEvents]);

  useEffect(() => {
    if (sessionId && connectionState.status === "connected") {
      const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0;
      subscribe(sessionId, lastSeq);
      return () => unsubscribe(sessionId);
    }
  }, [sessionId, connectionState.status, subscribe, unsubscribe]);

  useEffect(() => {
    if (sessionData) {
      setSessionStatus(sessionData.status as SessionStatus);
    }
  }, [sessionData]);

  const handleSelectSession = useCallback((id: string) => {
    setEvents([]);
    router.push(`/chat?session=${id}`);
  }, [router]);

  const handleSendMessage = useCallback((message: string) => {
    if (!sessionId) return;
    sendInput(sessionId, message);
  }, [sessionId, sendInput]);

  const handleStopSession = useCallback(() => {
    if (!sessionId) return;
    stopSession(sessionId);
  }, [sessionId, stopSession]);

  const isConnected = connectionState.status === "connected";
  const canSend = isConnected && (sessionStatus === "running" || sessionStatus === "idle");

  return (
    <div className="flex h-screen">
      <div className="w-64 shrink-0">
        <SessionList
          selectedId={sessionId ?? undefined}
          onSelect={handleSelectSession}
        />
      </div>

      <div className="flex flex-1 flex-col">
        <ConnectionIndicator
          status={connectionState.status}
          error={connectionState.error}
          reconnectAttempt={connectionState.reconnectAttempt}
          reconnectIn={connectionState.reconnectIn}
          onReconnect={reconnect}
        />

        {sessionId && sessionData ? (
          <>
            <SessionHeader
              title={sessionData.title ?? `Session ${sessionData.id.slice(0, 8)}`}
              status={sessionStatus}
              agentType={sessionData.agentType}
              workingDirectory={sessionData.workingDirectory ?? undefined}
              onStop={handleStopSession}
            />
            
            <MessageStream
              sessionId={sessionId}
              events={events}
              isConnected={isConnected}
            />
            
            <InputComposer
              onSend={handleSendMessage}
              disabled={!canSend}
              placeholder={
                !isConnected ? "Connecting..." :
                sessionStatus === "stopped" ? "Session stopped" :
                sessionStatus === "error" ? "Session error" :
                "Type a message..."
              }
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-gray-500">
            <div className="text-center">
              <div className="text-lg font-medium">Select a session</div>
              <div className="mt-1 text-sm">
                Choose a session from the sidebar or create a new one
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
