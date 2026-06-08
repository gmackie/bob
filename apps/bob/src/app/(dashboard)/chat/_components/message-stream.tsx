"use client";

import { useEffect, useRef } from "react";

import { cn } from "@gmacko/core/ui";

import { collapseSessionEventsToMessages } from "~/components/runs/session-event-format";
import type { SessionEvent } from "~/hooks/use-session-socket";

interface MessageStreamProps {
  sessionId: string;
  events: SessionEvent[];
  isConnected: boolean;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function MessageBubble({ msg }: { msg: ReturnType<typeof collapseSessionEventsToMessages>[number] }) {
  const isUser = msg.role === "user";

  if (msg.toolCalls?.length) {
    return (
      <div className="px-4 py-2">
        {msg.toolCalls.map((tc) => (
          <div
            key={tc.id || tc.name}
            className="flex items-center gap-2 rounded-md bg-accent/50 px-3 py-1.5 text-xs text-muted-foreground"
          >
            <span className="size-1.5 rounded-full bg-primary/60" />
            <span className="font-mono">{tc.name}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("px-4 py-3", !isUser && "bg-accent/30")}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">
          {isUser ? "You" : "blder.bot"}
        </span>
        {msg.time && (
          <span className="text-[10px] text-muted-foreground">
            {formatTime(msg.time)}
          </span>
        )}
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-secondary-foreground">
        {msg.content}
      </div>
    </div>
  );
}

export function MessageStream({
  sessionId,
  events,
  isConnected,
}: MessageStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messages = collapseSessionEventsToMessages(events);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          {isConnected ? "Waiting for messages..." : "Connecting..."}
        </p>
        {isConnected && (
          <p className="text-xs text-muted-foreground/60">
            Send a message to start the conversation.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {messages.map((msg) => (
        <MessageBubble key={`${sessionId}-${msg.seq}`} msg={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
