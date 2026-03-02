"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@bob/ui";
import type { SessionEvent } from "~/hooks/use-session-socket";

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

function toDisplayText(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return "";

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function timestampForTranscript(
  timestamp: unknown,
  fallback: string,
): string {
  const parsed = toDisplayText(timestamp);
  return parsed.trim() || fallback;
}

function toolCallIndicatorClass({
  result,
  isError,
}: {
  result?: string;
  isError?: boolean;
}) {
  if (!result) return "chat-toolCallIndicator--loading";
  return isError ? "chat-toolCallIndicator--error" : "chat-toolCallIndicator--success";
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
        content: toDisplayText(event.payload.data),
        timestamp: new Date(event.createdAt),
      });
    }

    if (event.eventType === "output_chunk" && event.direction === "agent") {
      currentAssistantContent += toDisplayText(event.payload.data);
      lastAssistantSeq = event.seq;
    }

    if (event.eventType === "message_final" && event.direction === "agent") {
      currentAssistantContent = toDisplayText(event.payload.content);
      lastAssistantSeq = event.seq;
    }

    if (event.eventType === "tool_call" && event.direction === "agent") {
      const toolCallId = toDisplayText(event.payload.toolCallId);
      if (!toolCallId) continue;

      currentToolCalls.push({
        id: toolCallId,
        name: toDisplayText(event.payload.name) || "tool",
        arguments: toDisplayText(event.payload.arguments),
      });
      lastAssistantSeq = event.seq;
    }

    if (event.eventType === "tool_result" && event.direction === "agent") {
      const toolCall = currentToolCalls.find(
        (tc) => tc.id === toDisplayText(event.payload.toolCallId),
      );
      if (toolCall) {
        toolCall.result = toDisplayText(event.payload.result);
        toolCall.isError = event.payload.isError === true;
      }
      lastAssistantSeq = event.seq;
    }

    if (event.eventType === "state" && event.direction === "system") {
      const status = toDisplayText(event.payload.status) || "Update";
      const reason = toDisplayText(event.payload.reason);
      const reasonSuffix = reason ? `: ${reason}` : "";

      messages.push({
        id: `system-${event.seq}`,
        role: "system",
        content: `Session ${status}${reasonSuffix}`,
        timestamp: new Date(event.createdAt),
      });
    }

    if (event.eventType === "error") {
      const message = toDisplayText(event.payload.message) || "Unknown error";

      messages.push({
        id: `error-${event.seq}`,
        role: "system",
        content: `Error: ${message}`,
        timestamp: new Date(event.createdAt),
      });
    }

    if (event.eventType === "transcript") {
      const transcriptTypeRaw = toDisplayText(event.payload.type);
      const transcriptType =
        transcriptTypeRaw === "user" ? "user" : "assistant";
      const transcriptText = toDisplayText(event.payload.text);

      messages.push({
        id: `transcript-${event.seq}`,
        role: transcriptType,
        content: transcriptText,
        timestamp: new Date(
          timestampForTranscript(event.payload.timestamp, event.createdAt),
        ),
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
    <div className="chat-toolCall">
      <button
        onClick={() => setExpanded(!expanded)}
        className="chat-toolCallToggle"
        type="button"
      >
        <span
          className={cn(
            "chat-toolCallIndicator",
            toolCallIndicatorClass({
              result: toolCall.result,
              isError: toolCall.isError,
            }),
          )}
        />
        <span className="chat-toolCallName">{toolCall.name}</span>
        <span className="chat-toolCallChevron">{expanded ? "▼" : "▶"}</span>
      </button>

      {expanded && (
        <div className="chat-toolCallBody">
          <div className="mb-2">
            <div className="chat-toolCallTitle">Arguments:</div>
            <pre className="chat-toolCode">
              {(() => {
                try {
                  return JSON.stringify(
                    JSON.parse(toolCall.arguments),
                    null,
                    2,
                  );
                } catch {
                  return toolCall.arguments;
                }
              })()}
            </pre>
          </div>

          {toolCall.result !== undefined && (
            <div>
              <div className="chat-toolCallTitle">
                {toolCall.isError ? "Error:" : "Result:"}
              </div>
              <pre className={cn("chat-toolCode", toolCall.isError && "is-error")}>
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
    return <div className="chat-systemMessage">{message.content}</div>;
  }

  const isUser = message.role === "user";
  const roleLabel = isUser ? "You" : "Agent";

  return (
    <div className={cn("chat-messageRow", isUser && "is-user")}>
      <div
        className={cn(
          "chat-messageBubble",
          isUser
            ? "chat-messageBubble--user"
            : "chat-messageBubble--assistant",
        )}
      >
        <div className="chat-messageMeta">
          <span>{roleLabel}</span>
          <time
            dateTime={message.timestamp.toISOString()}
            className="chat-messageTime"
          >
            {formatTimestamp(message.timestamp)}
          </time>
        </div>
        <div className="chat-messageText">{message.content}</div>

        {message.toolCalls?.map((tc) => (
          <ToolCallDisplay key={tc.id} toolCall={tc} />
        ))}

        {message.isStreaming && <span className="chat-streamingDot" />}
      </div>
    </div>
  );
}

export function MessageStream({
  sessionId,
  events,
  isConnected,
}: MessageStreamProps) {
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
      className="chat-stream"
      data-session-id={sessionId}
    >
      {!isConnected && (
        <div className="chat-banner chat-banner--disconnect">
          Disconnected - reconnecting...
        </div>
      )}

      {messages.length === 0 ? (
        <div className="chat-emptyState">
          <div>
            <div className="chat-emptyStateTitle">Start a conversation</div>
            <div className="chat-emptyStateSubtext">
              Type a message below to begin
            </div>
          </div>
        </div>
      ) : (
        messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
      )}
    </div>
  );
}
