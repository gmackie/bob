"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@bob/ui";
import type { SessionEvent, SessionEventType } from "~/hooks/use-session-socket";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCall[];
  timestamp: Date;
  isStreaming?: boolean;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  isError?: boolean;
}

interface MessageStreamProps {
  sessionId: string;
  events: SessionEvent[];
  isConnected: boolean;
}

function parseEventsToMessages(events: SessionEvent[]): Message[] {
  const messages: Message[] = [];
  let currentAssistantContent = "";
  let currentToolCalls: ToolCall[] = [];
  let lastAssistantSeq = 0;

  for (const event of events) {
    if (event.eventType === "input" && event.direction === "client") {
      if (currentAssistantContent || currentToolCalls.length > 0) {
        messages.push({
          id: `assistant-${lastAssistantSeq}`,
          role: "assistant",
          content: currentAssistantContent,
          toolCalls: currentToolCalls.length > 0 ? [...currentToolCalls] : undefined,
          timestamp: new Date(event.createdAt),
        });
        currentAssistantContent = "";
        currentToolCalls = [];
      }

      messages.push({
        id: `user-${event.seq}`,
        role: "user",
        content: event.payload.data as string,
        timestamp: new Date(event.createdAt),
      });
    }

    if (event.eventType === "output_chunk" && event.direction === "agent") {
      currentAssistantContent += event.payload.data as string;
      lastAssistantSeq = event.seq;
    }

    if (event.eventType === "message_final" && event.direction === "agent") {
      currentAssistantContent = event.payload.content as string;
      lastAssistantSeq = event.seq;
    }

    if (event.eventType === "tool_call" && event.direction === "agent") {
      currentToolCalls.push({
        id: event.payload.toolCallId as string,
        name: event.payload.name as string,
        arguments: event.payload.arguments as string,
      });
      lastAssistantSeq = event.seq;
    }

    if (event.eventType === "tool_result" && event.direction === "agent") {
      const toolCall = currentToolCalls.find(tc => tc.id === event.payload.toolCallId);
      if (toolCall) {
        toolCall.result = event.payload.result as string;
        toolCall.isError = event.payload.isError as boolean;
      }
      lastAssistantSeq = event.seq;
    }

    if (event.eventType === "state" && event.direction === "system") {
      messages.push({
        id: `system-${event.seq}`,
        role: "system",
        content: `Session ${event.payload.status}${event.payload.reason ? `: ${event.payload.reason}` : ""}`,
        timestamp: new Date(event.createdAt),
      });
    }

    if (event.eventType === "error") {
      messages.push({
        id: `error-${event.seq}`,
        role: "system",
        content: `Error: ${event.payload.message}`,
        timestamp: new Date(event.createdAt),
      });
    }
  }

  if (currentAssistantContent || currentToolCalls.length > 0) {
    messages.push({
      id: `assistant-${lastAssistantSeq}`,
      role: "assistant",
      content: currentAssistantContent,
      toolCalls: currentToolCalls.length > 0 ? [...currentToolCalls] : undefined,
      timestamp: new Date(),
      isStreaming: true,
    });
  }

  return messages;
}

function ToolCallDisplay({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2 rounded border bg-gray-50 dark:bg-gray-900">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 p-2 text-left text-sm"
      >
        <span className={cn(
          "inline-block h-2 w-2 rounded-full",
          toolCall.result === undefined ? "bg-blue-500 animate-pulse" :
          toolCall.isError ? "bg-red-500" : "bg-green-500"
        )} />
        <span className="font-mono font-medium">{toolCall.name}</span>
        <span className="ml-auto text-gray-400">{expanded ? "▼" : "▶"}</span>
      </button>
      
      {expanded && (
        <div className="border-t p-2">
          <div className="mb-2">
            <div className="mb-1 text-xs font-medium text-gray-500">Arguments:</div>
            <pre className="overflow-x-auto rounded bg-gray-100 p-2 text-xs dark:bg-gray-800">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(toolCall.arguments), null, 2);
                } catch {
                  return toolCall.arguments;
                }
              })()}
            </pre>
          </div>
          
          {toolCall.result !== undefined && (
            <div>
              <div className="mb-1 text-xs font-medium text-gray-500">
                {toolCall.isError ? "Error:" : "Result:"}
              </div>
              <pre className={cn(
                "overflow-x-auto rounded p-2 text-xs",
                toolCall.isError ? "bg-red-50 dark:bg-red-900/20" : "bg-gray-100 dark:bg-gray-800"
              )}>
                {toolCall.result.slice(0, 1000)}
                {toolCall.result.length > 1000 && "..."}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <div className="my-2 text-center text-xs text-gray-500">
        {message.content}
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div className={cn("my-3 flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-4 py-2",
          isUser
            ? "bg-blue-600 text-white"
            : "bg-gray-100 dark:bg-gray-800"
        )}
      >
        <div className="whitespace-pre-wrap text-sm">{message.content}</div>
        
        {message.toolCalls?.map((tc) => (
          <ToolCallDisplay key={tc.id} toolCall={tc} />
        ))}
        
        {message.isStreaming && (
          <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        )}
      </div>
    </div>
  );
}

export function MessageStream({ sessionId, events, isConnected }: MessageStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const messages = parseEventsToMessages(events);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages.length]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4"
    >
      {!isConnected && (
        <div className="mb-4 rounded bg-yellow-50 p-2 text-center text-sm text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
          Disconnected - reconnecting...
        </div>
      )}

      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="text-lg font-medium">Start a conversation</div>
            <div className="mt-1 text-sm">Type a message below to begin</div>
          </div>
        </div>
      ) : (
        messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
      )}
    </div>
  );
}
