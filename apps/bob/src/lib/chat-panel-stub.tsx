"use client";

import { createContext, useContext } from "react";

const ChatPanelContext = createContext({
  isOpen: false,
  sessionId: null as string | null,
  workItemId: null as string | null,
  contextLabel: null as string | null,
  openPanel: () => {},
  closePanel: () => {},
  openPlanningSession: () => {},
  isPlanningSessionLoading: false,
});

export function useChatPanel() {
  return useContext(ChatPanelContext);
}

export function ChatPanelProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
