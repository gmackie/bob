"use client";

import { useState, useRef, useEffect } from "react";
import { useCreateThread, useAgentChat } from "@/rpc/hooks";

export default function CapturePage() {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const createThread = useCreateThread();
  const agentChat = useAgentChat();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;
    setIsLoading(true);
    try {
      // Create a quick capture thread
      const thread = await createThread.mutateAsync({
        title: input.trim().slice(0, 60),
        tags: [],
      });
      if (!thread.activeBranchId) {
        throw new Error("Thread created without an active branch");
      }
      // Send to agent
      const msg = await agentChat.mutateAsync({
        threadId: thread.id,
        branchId: thread.activeBranchId,
        content: input.trim(),
      });
      setResponse(msg.content);
    } catch (err) {
      setResponse(
        "Error: " + (err instanceof Error ? err.message : "Unknown error"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      // In Electron, this will blur -> close the window
      window.blur();
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg)]/95 p-8">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6 shadow-2xl">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What's on your mind?"
          rows={3}
          className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-[var(--color-text-muted)]">
            Cmd+Enter to send - Esc to close
          </span>
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-bg)] disabled:opacity-50"
          >
            {isLoading ? "Thinking..." : "Capture"}
          </button>
        </div>
        {response && (
          <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-4 text-sm text-[var(--color-text)]">
            {response}
          </div>
        )}
      </div>
    </div>
  );
}
