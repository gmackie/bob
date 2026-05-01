"use client";

import { useEffect } from "react";

export type Shortcut = {
  key: string;
  meta?: boolean; // Cmd on Mac
  shift?: boolean;
  handler: () => void;
  description: string;
};

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      for (const s of shortcuts) {
        if (
          e.key.toLowerCase() === s.key.toLowerCase() &&
          !!e.metaKey === !!s.meta &&
          !!e.shiftKey === !!s.shift
        ) {
          e.preventDefault();
          s.handler();
          return;
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}
