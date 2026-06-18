"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

interface ChatPanelState {
  isOpen: boolean;
  sessionId: string | null;
  workItemId: string | null;
  contextLabel: string | null;
  openPanel: (opts?: { sessionId?: string; workItemId?: string; label?: string }) => void;
  closePanel: () => void;
  openPlanningSession: (opts: { workItemId: string; goal: string }) => void;
  isPlanningSessionLoading: boolean;
}

const ChatPanelContext = createContext<ChatPanelState>({
  isOpen: false,
  sessionId: null,
  workItemId: null,
  contextLabel: null,
  openPanel: () => {},
  closePanel: () => {},
  openPlanningSession: () => {},
  isPlanningSessionLoading: false,
});

export function useChatPanel() {
  return useContext(ChatPanelContext);
}

export function ChatPanelProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workItemId, setWorkItemId] = useState<string | null>(null);
  const [contextLabel, setContextLabel] = useState<string | null>(null);

  const trpc = useTRPC();

  const openPanel = useCallback(
    (opts?: { sessionId?: string; workItemId?: string; label?: string }) => {
      if (opts?.sessionId) setSessionId(opts.sessionId);
      if (opts?.workItemId) setWorkItemId(opts.workItemId);
      if (opts?.label) setContextLabel(opts.label);
      setIsOpen(true);
    },
    [],
  );

  const closePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  const createPlanningSession = useMutation(
    trpc.planSession.create.mutationOptions({
      onSuccess: (data: { id: string }) => {
        setSessionId(data.id);
        setIsOpen(true);
      },
    }),
  );

  const openPlanningSession = useCallback(
    (opts: { workItemId: string; goal: string }) => {
      setWorkItemId(opts.workItemId);
      setContextLabel(`Planning: ${opts.goal}`);
      createPlanningSession.mutate({
        workItemId: opts.workItemId,
        title: opts.goal,
      });
    },
    [createPlanningSession],
  );

  const value = useMemo<ChatPanelState>(
    () => ({
      isOpen,
      sessionId,
      workItemId,
      contextLabel,
      openPanel,
      closePanel,
      openPlanningSession,
      isPlanningSessionLoading: createPlanningSession.isPending,
    }),
    [
      isOpen,
      sessionId,
      workItemId,
      contextLabel,
      openPanel,
      closePanel,
      openPlanningSession,
      createPlanningSession.isPending,
    ],
  );

  return (
    <ChatPanelContext.Provider value={value}>
      {children}
    </ChatPanelContext.Provider>
  );
}
