"use client";

import { useCallback, useRef, useState } from "react";

interface InputComposerProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  sessionId?: string;
  placeholder?: string;
}

export function InputComposer({
  onSend,
  disabled = false,
  placeholder = "Type a message...",
}: InputComposerProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    inputRef.current?.focus();
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="px-3 py-2">
      <div className="flex items-end gap-2 rounded-lg border border-border bg-background px-3 py-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="max-h-32 min-h-[20px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="shrink-0 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
