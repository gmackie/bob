"use client";

import { useState } from "react";
import { Button } from "../button";
import { cn } from "../utils";

interface ComposerProps {
  onSend: (content: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function Composer({
  onSend,
  placeholder = "Type a message...",
  disabled = false,
}: ComposerProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-border bg-background p-4"
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className={cn(
          "flex-1 resize-none rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring",
        )}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
      />
      <Button
        type="submit"
        size="default"
        disabled={disabled || !value.trim()}
        aria-label="Send"
      >
        Send
      </Button>
    </form>
  );
}
