"use client";

import { useEffect } from "react";

interface HotkeyDefinition {
  key: string;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: (e: KeyboardEvent) => void;
}

export function useHotkeys(hotkeys: HotkeyDefinition[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger hotkeys when typing in inputs/textareas
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        // Allow Escape always
        if (e.key !== "Escape") return;
      }

      for (const hotkey of hotkeys) {
        const metaMatch = hotkey.meta ? e.metaKey : !e.metaKey;
        const shiftMatch = hotkey.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = hotkey.alt ? e.altKey : !e.altKey;

        if (
          e.key.toLowerCase() === hotkey.key.toLowerCase() &&
          metaMatch &&
          shiftMatch &&
          altMatch
        ) {
          e.preventDefault();
          hotkey.handler(e);
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hotkeys]);
}
