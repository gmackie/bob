import { createContext, useContext  } from "react";
import type {ReactNode} from "react";

import { useOodaConversation } from "./hooks/use-ooda-conversation";

export type OodaConversationState = ReturnType<typeof useOodaConversation>;

const OodaConversationContext = createContext<OodaConversationState | null>(null);

/**
 * Hosts the OODA conversation state once for the tablet shell so the sidebar
 * (conversation list) and the main pane (chat) share it. The phone stack
 * doesn't use this — ChatScreen owns its own state there.
 */
export function OodaConversationProvider({ children }: { children: ReactNode }) {
  const chat = useOodaConversation();
  return (
    <OodaConversationContext.Provider value={chat}>
      {children}
    </OodaConversationContext.Provider>
  );
}

export function useOodaConversationContext(): OodaConversationState | null {
  return useContext(OodaConversationContext);
}
