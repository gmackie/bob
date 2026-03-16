"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface ChatPanelState {
  isOpen: boolean;
  sessionId: string | null;
  workItemId: string | null;
  contextLabel: string | null;
}

interface ChatPanelContextValue extends ChatPanelState {
  openPanel: (opts?: {
    sessionId?: string;
    workItemId?: string;
    label?: string;
  }) => void;
  closePanel: () => void;
}

const ChatPanelContext = createContext<ChatPanelContextValue>({
  isOpen: false,
  sessionId: null,
  workItemId: null,
  contextLabel: null,
  openPanel: () => {},
  closePanel: () => {},
});

export function useChatPanel() {
  return useContext(ChatPanelContext);
}

export function ChatPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<ChatPanelState>({
    isOpen: false,
    sessionId: null,
    workItemId: null,
    contextLabel: null,
  });

  const openPanel = useCallback(
    (opts?: {
      sessionId?: string;
      workItemId?: string;
      label?: string;
    }) => {
      setState({
        isOpen: true,
        sessionId: opts?.sessionId ?? null,
        workItemId: opts?.workItemId ?? null,
        contextLabel: opts?.label ?? null,
      });
    },
    [],
  );

  const closePanel = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const value = useMemo(
    () => ({ ...state, openPanel, closePanel }),
    [state, openPanel, closePanel],
  );

  return (
    <ChatPanelContext.Provider value={value}>
      {children}
    </ChatPanelContext.Provider>
  );
}
