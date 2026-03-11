"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useRouter } from "next/navigation";

interface ShortcutHandler {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  description: string;
  category: string;
}

interface ChordShortcut {
  chord: string;
  key: string;
  action: () => void;
  description: string;
  category: string;
}

const CHORD_TIMEOUT = 800;

export function useKeyboardShortcuts(
  shortcuts: ShortcutHandler[],
  chordShortcuts: ChordShortcut[] = [],
  enabled = true
) {
  const [chordMode, setChordMode] = useState<string | null>(null);
  const chordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (chordMode) {
        for (const chord of chordShortcuts) {
          if (chord.chord === chordMode && e.key.toLowerCase() === chord.key.toLowerCase()) {
            e.preventDefault();
            chord.action();
            setChordMode(null);
            if (chordTimeoutRef.current) {
              clearTimeout(chordTimeoutRef.current);
              chordTimeoutRef.current = null;
            }
            return;
          }
        }

        setChordMode(null);
        if (chordTimeoutRef.current) {
          clearTimeout(chordTimeoutRef.current);
          chordTimeoutRef.current = null;
        }
      }

      const chordStarters = [...new Set(chordShortcuts.map((c) => c.chord))];
      if (chordStarters.includes(e.key.toLowerCase()) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setChordMode(e.key.toLowerCase());
        chordTimeoutRef.current = setTimeout(() => {
          setChordMode(null);
        }, CHORD_TIMEOUT);
        return;
      }

      for (const shortcut of shortcuts) {
        const keyMatches = e.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatches = shortcut.ctrl === undefined || shortcut.ctrl === e.ctrlKey;
        const metaMatches = shortcut.meta === undefined || shortcut.meta === e.metaKey;
        const shiftMatches = shortcut.shift === undefined || shortcut.shift === e.shiftKey;
        const altMatches = shortcut.alt === undefined || shortcut.alt === e.altKey;

        if (keyMatches && ctrlMatches && metaMatches && shiftMatches && altMatches) {
          e.preventDefault();
          shortcut.action();
          return;
        }
      }
    },
    [shortcuts, chordShortcuts, enabled, chordMode]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    return () => {
      if (chordTimeoutRef.current) {
        clearTimeout(chordTimeoutRef.current);
      }
    };
  }, []);

  return { chordMode };
}

export function useGlobalShortcuts(workspaceSlug?: string) {
  const router = useRouter();
  const baseUrl = workspaceSlug ? `/dashboard/${workspaceSlug}` : "/dashboard";

  const shortcuts: ShortcutHandler[] = [
    {
      key: "c",
      action: () => router.push(`${baseUrl}/tasks/all?new=true`),
      description: "Create new task",
      category: "Actions",
    },
    {
      key: "?",
      shift: true,
      action: () => {
        const event = new CustomEvent("show-shortcuts-help");
        document.dispatchEvent(event);
      },
      description: "Show keyboard shortcuts",
      category: "Help",
    },
  ];

  const chordShortcuts: ChordShortcut[] = [
    {
      chord: "g",
      key: "h",
      action: () => router.push(`${baseUrl}/home`),
      description: "Go to home",
      category: "Navigation",
    },
    {
      chord: "g",
      key: "i",
      action: () => router.push(`${baseUrl}/inbox`),
      description: "Go to inbox",
      category: "Navigation",
    },
    {
      chord: "g",
      key: "m",
      action: () => {
        router.push(`${baseUrl}/tasks/all`);
        setTimeout(() => {
          const event = new CustomEvent("toggle-my-issues");
          document.dispatchEvent(event);
        }, 100);
      },
      description: "Go to my issues",
      category: "Navigation",
    },
    {
      chord: "g",
      key: "a",
      action: () => router.push(`${baseUrl}/tasks/all`),
      description: "Go to all issues",
      category: "Navigation",
    },
    {
      chord: "g",
      key: "p",
      action: () => router.push(`${baseUrl}/projects`),
      description: "Go to projects",
      category: "Navigation",
    },
    {
      chord: "g",
      key: "v",
      action: () => router.push(`${baseUrl}/views`),
      description: "Go to views",
      category: "Navigation",
    },
    {
      chord: "g",
      key: "s",
      action: () => router.push(`${baseUrl}/settings`),
      description: "Go to settings",
      category: "Navigation",
    },
  ];

  const { chordMode } = useKeyboardShortcuts(shortcuts, chordShortcuts, !!workspaceSlug);

  return { shortcuts, chordShortcuts, chordMode };
}

export function useTaskShortcuts(callbacks: {
  onStatusChange?: (status: string) => void;
  onPriorityChange?: (priority: string) => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}) {
  const shortcuts: ShortcutHandler[] = [];

  if (callbacks.onStatusChange) {
    shortcuts.push(
      {
        key: "1",
        action: () => callbacks.onStatusChange!("backlog"),
        description: "Set status to Backlog",
        category: "Status",
      },
      {
        key: "2",
        action: () => callbacks.onStatusChange!("todo"),
        description: "Set status to Todo",
        category: "Status",
      },
      {
        key: "3",
        action: () => callbacks.onStatusChange!("in_progress"),
        description: "Set status to In Progress",
        category: "Status",
      },
      {
        key: "4",
        action: () => callbacks.onStatusChange!("in_review"),
        description: "Set status to In Review",
        category: "Status",
      },
      {
        key: "5",
        action: () => callbacks.onStatusChange!("done"),
        description: "Set status to Done",
        category: "Status",
      }
    );
  }

  if (callbacks.onPriorityChange) {
    shortcuts.push(
      {
        key: "0",
        action: () => callbacks.onPriorityChange!("no_priority"),
        description: "Set priority to None",
        category: "Priority",
      },
      {
        key: "!",
        shift: true,
        action: () => callbacks.onPriorityChange!("urgent"),
        description: "Set priority to Urgent",
        category: "Priority",
      }
    );
  }

  if (callbacks.onArchive) {
    shortcuts.push({
      key: "e",
      action: callbacks.onArchive,
      description: "Archive task",
      category: "Actions",
    });
  }

  if (callbacks.onDelete) {
    shortcuts.push({
      key: "Backspace",
      meta: true,
      action: callbacks.onDelete,
      description: "Delete task",
      category: "Actions",
    });
  }

  if (callbacks.onDuplicate) {
    shortcuts.push({
      key: "d",
      meta: true,
      action: callbacks.onDuplicate,
      description: "Duplicate task",
      category: "Actions",
    });
  }

  useKeyboardShortcuts(shortcuts);

  return shortcuts;
}

export const ALL_SHORTCUTS = [
  { key: "⌘K", description: "Open command palette", category: "General" },
  { key: "C", description: "Create new task", category: "Actions" },
  { key: "G then H", description: "Go to home", category: "Navigation" },
  { key: "G then I", description: "Go to inbox", category: "Navigation" },
  { key: "G then M", description: "Go to my issues", category: "Navigation" },
  { key: "G then A", description: "Go to all issues", category: "Navigation" },
  { key: "G then P", description: "Go to projects", category: "Navigation" },
  { key: "G then V", description: "Go to views", category: "Navigation" },
  { key: "G then S", description: "Go to settings", category: "Navigation" },
  { key: "1-5", description: "Change task status", category: "Task" },
  { key: "0", description: "Remove priority", category: "Task" },
  { key: "Shift+!", description: "Set urgent priority", category: "Task" },
  { key: "E", description: "Archive task", category: "Task" },
  { key: "⌘+Backspace", description: "Delete task", category: "Task" },
  { key: "⌘D", description: "Duplicate task", category: "Task" },
  { key: "?", description: "Show shortcuts help", category: "Help" },
  { key: "Escape", description: "Close modal/panel", category: "General" },
];
