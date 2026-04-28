"use client";

import { useEffect, useRef } from "react";

import { cn } from "@bob/ui";

import type { SessionEvent } from "~/hooks/use-session-socket";

interface MessageStreamProps {
  sessionId: string;
  events: SessionEvent[];
  isConnected: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  seq: number;
  time: string;
  toolCalls?: Array<{ name: string; id: string }>;
}

function collapseEventsToMessages(events: SessionEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let pendingChunks: string[] = [];
  let pendingSeq = 0;
  let pendingTime = "";

  const flushChunks = () => {
    if (pendingChunks.length > 0) {
      messages.push({
        role: "assistant",
        content: pendingChunks.join(""),
        seq: pendingSeq,
        time: pendingTime,
      });
      pendingChunks = [];
    }
  };

  for (const event of events) {
    if (event.eventType === "input" && event.direction === "client") {
      flushChunks();
      const text =
        typeof event.payload.content === "string"
          ? event.payload.content
          : typeof event.payload.text === "string"
            ? event.payload.text
            : typeof event.payload.data === "string"
              ? event.payload.data
              : JSON.stringify(event.payload);
      messages.push({
        role: "user",
        content: text,
        seq: event.seq,
        time: event.createdAt,
      });
    } else if (event.eventType === "output_chunk" && event.direction === "agent") {
      if (pendingChunks.length === 0) {
        pendingSeq = event.seq;
        pendingTime = event.createdAt;
      }
      const chunk =
        typeof event.payload.content === "string"
          ? event.payload.content
          : typeof event.payload.text === "string"
            ? event.payload.text
            : typeof event.payload.chunk === "string"
              ? event.payload.chunk
              : "";
      if (chunk) pendingChunks.push(chunk);
    } else if (event.eventType === "message_final" && event.direction === "agent") {
      flushChunks();
      const content =
        typeof event.payload.content === "string"
          ? event.payload.content
          : typeof event.payload.text === "string"
            ? event.payload.text
            : "";
      if (content) {
        messages.push({
          role: "assistant",
          content,
          seq: event.seq,
          time: event.createdAt,
        });
      }
    } else if (event.eventType === "tool_call" && event.direction === "agent") {
      flushChunks();
      const name =
        typeof event.payload.name === "string" ? event.payload.name : "tool";
      const id =
        typeof event.payload.id === "string" ? event.payload.id : "";
      messages.push({
        role: "assistant",
        content: "",
        seq: event.seq,
        time: event.createdAt,
        toolCalls: [{ name, id }],
      });
    } else if (event.eventType === "error") {
      flushChunks();
      const msg =
        typeof event.payload.message === "string"
          ? event.payload.message
          : typeof event.payload.error === "string"
            ? event.payload.error
            : "An error occurred";
      messages.push({
        role: "assistant",
        content: `⚠ ${msg}`,
        seq: event.seq,
        time: event.createdAt,
      });
    }
  }
  flushChunks();
  return messages;
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

function MessageBubble({ msg }: { msg: ChatMessage }) {
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
  const messages = collapseEventsToMessages(events);

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
