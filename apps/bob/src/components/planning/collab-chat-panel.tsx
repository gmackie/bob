"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@gmacko/core/ui";

import type { PlanningCollabMessage } from "~/hooks/use-planning-collaboration";

interface CollabChatPanelProps {
  messages: PlanningCollabMessage[];
  currentUserId?: string | null;
  onSend: (body: string) => Promise<void> | void;
  disabled?: boolean;
  isSending?: boolean;
  className?: string;
}

export function CollabChatPanel({
  messages,
  currentUserId,
  onSend,
  disabled,
  isSending,
  className,
}: CollabChatPanelProps) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || disabled || isSending) return;
    setDraft("");
    await onSend(body);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Team chat
        </h3>
        <p className="text-[11px] text-muted-foreground/80">
          Live notes with collaborators in this planning session
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No team messages yet. Say hi or share a planning note.
          </p>
        ) : (
          messages.map((msg) => {
            const mine = currentUserId != null && msg.userId === currentUserId;
            return (
              <div
                key={msg.id ?? msg.clientMessageId ?? `${msg.userId}-${msg.createdAt}`}
                className={cn(
                  "max-w-[90%] rounded-lg px-2.5 py-1.5 text-sm",
                  mine
                    ? "ml-auto bg-primary/15 text-foreground"
                    : "bg-muted/60 text-foreground",
                )}
              >
                <div className="mb-0.5 flex items-baseline gap-2">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {mine ? "You" : msg.displayName}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">
                    {formatTime(msg.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex items-center gap-2 border-t border-border p-2"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled || isSending}
          placeholder={disabled ? "Read-only" : "Message the team..."}
          maxLength={4000}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="submit"
          disabled={disabled || isSending || !draft.trim()}
          className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
