"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  useKeyboardShortcuts,
  type Shortcut,
} from "~/hooks/use-keyboard-shortcuts";

interface Command {
  id: string;
  label: string;
  shortcut: string;
  handler: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const commands: Command[] = [
    {
      id: "new-thread",
      label: "New Thread",
      shortcut: "\u2318N",
      handler: () => {
        router.push("/threads?new=1");
      },
    },
    {
      id: "export-brief",
      label: "Export Brief",
      shortcut: "\u2318E",
      handler: () => {
        // placeholder for export functionality
      },
    },
    {
      id: "go-threads",
      label: "Go to Threads",
      shortcut: "\u2318T",
      handler: () => {
        router.push("/threads");
      },
    },
    {
      id: "go-health",
      label: "Go to Health",
      shortcut: "\u2318H",
      handler: () => {
        router.push("/health");
      },
    },
  ];

  const filtered = query
    ? commands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()),
      )
    : commands;

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Small delay to ensure the modal is rendered
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  const executeCommand = useCallback(
    (command: Command) => {
      setOpen(false);
      command.handler();
    },
    [],
  );

  // Handle keyboard navigation inside the palette
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[selectedIndex];
        if (cmd) executeCommand(cmd);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [filtered, selectedIndex, executeCommand],
  );

  // Global shortcuts
  const shortcuts: Shortcut[] = [
    {
      key: "k",
      meta: true,
      handler: () => setOpen((prev) => !prev),
      description: "Toggle command palette",
    },
    {
      key: "n",
      meta: true,
      handler: () => router.push("/threads?new=1"),
      description: "New thread",
    },
    {
      key: "e",
      meta: true,
      handler: () => {
        // placeholder for export
      },
      description: "Export brief",
    },
    {
      key: "t",
      meta: true,
      handler: () => router.push("/threads"),
      description: "Go to threads",
    },
    {
      key: "h",
      meta: true,
      handler: () => router.push("/health"),
      description: "Go to health",
    },
  ];

  useKeyboardShortcuts(shortcuts);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/60"
      onClick={() => setOpen(false)}
    >
      <div
        className="mx-3 w-full rounded-[6px] border border-[#2A2A2F] bg-[#1A1A1E] shadow-xl md:mx-0 md:max-w-md"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="border-b border-[#2A2A2F] px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            className="w-full bg-transparent text-sm text-[#E8E4DF] placeholder-[#5A5855] outline-none"
          />
        </div>

        {/* Command list */}
        <div className="max-h-64 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[#5A5855]">
              No commands found
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => executeCommand(cmd)}
                className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors ${
                  i === selectedIndex
                    ? "bg-[#D4A04A]/15 text-[#E8E4DF]"
                    : "text-[#8A8580] hover:bg-[#111113]"
                }`}
              >
                <span>{cmd.label}</span>
                <kbd className="rounded-[3px] border border-[#2A2A2F] bg-[#111113] px-1.5 py-0.5 font-mono text-[10px] text-[#5A5855]">
                  {cmd.shortcut}
                </kbd>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
