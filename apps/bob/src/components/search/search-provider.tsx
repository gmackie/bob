"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { useChatPanel } from "~/components/chat/chat-panel-provider";
import { useHotkeys } from "~/hooks/use-hotkeys";

import { CommandPalette } from "./command-palette";

interface SearchContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const SearchContext = createContext<SearchContextValue>({
  isOpen: false,
  open: () => {},
  close: () => {},
});

export function useSearch() {
  return useContext(SearchContext);
}

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const chatPanel = useChatPanel();

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useHotkeys(
    useMemo(
      () => [
        { key: "k", meta: true, handler: () => setIsOpen((o) => !o) },
        {
          key: "j",
          meta: true,
          handler: () => {
            if (chatPanel.isOpen) chatPanel.closePanel();
            else chatPanel.openPanel();
          },
        },
        { key: "Escape", handler: () => setIsOpen(false) },
      ],
      [chatPanel],
    ),
  );

  const value = useMemo(
    () => ({ isOpen, open, close }),
    [isOpen, open, close],
  );

  return (
    <SearchContext.Provider value={value}>
      {children}
      <CommandPalette open={isOpen} onClose={close} />
    </SearchContext.Provider>
  );
}
