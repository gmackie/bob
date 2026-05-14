import { useCallback, useEffect, useMemo } from "react";

import { useGateway } from "~/hooks/use-gateway";

import type { ChatMessage } from "../chat-messages";
import { collapseBobEventsToMessages } from "../chat-messages";

export type AgentChatStatus = "idle" | "connecting" | "connected" | "error";

export interface AgentChat {
  messages: ChatMessage[];
  send: (text: string) => void;
  promote?: (message: ChatMessage) => void;
  isStreaming: boolean;
  status: AgentChatStatus;
  statusText: string;
}

export function useBobChat(enabled: boolean): AgentChat {
  const gateway = useGateway();
  const activeSessionId = gateway.selectedSessionId ?? gateway.sessions[0]?.sessionId ?? null;

  useEffect(() => {
    if (!enabled) return;
    if (gateway.selectedSessionId || !gateway.sessions[0]?.sessionId) return;
    gateway.selectSession(gateway.sessions[0].sessionId);
  }, [enabled, gateway]);

  const send = useCallback(
    (text: string) => {
      if (!activeSessionId) return;
      gateway.sendInput(activeSessionId, text);
    },
    [activeSessionId, gateway],
  );

  const messages = useMemo(
    () => collapseBobEventsToMessages(gateway.selectedSessionEvents),
    [gateway.selectedSessionEvents],
  );

  const activeSession = gateway.sessions.find(
    (session) => session.sessionId === activeSessionId,
  );

  const status: AgentChatStatus =
    gateway.connectionState === "connected"
      ? "connected"
      : gateway.connectionState === "disconnected"
        ? "idle"
        : "connecting";

  return {
    messages,
    send,
    isStreaming: activeSession?.status === "running",
    status,
    statusText: activeSessionId
      ? `${gateway.connectionState} to Bob gateway`
      : "No Bob session available yet",
  };
}
