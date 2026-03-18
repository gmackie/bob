"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@bob/ui";
import type { SessionEvent } from "~/hooks/use-session-socket";
import { ImageMessage } from "./image-message";
import {
  SkillExecutionBlock,
  type SkillExecutionBlockProps,
} from "./skill-execution-block";

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

interface SkillStreamItem {
  kind: "skill";
  id: string;
  props: SkillExecutionBlockProps;
}

interface MessageStreamItem {
  kind: "message";
  id: string;
  message: Message;
}

type StreamItem = MessageStreamItem | SkillStreamItem;

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

function parseEventsToStream(events: SessionEvent[]): StreamItem[] {
  const items: StreamItem[] = [];
  let currentAssistantContent = "";
  let currentToolCalls: ToolCall[] = [];
  let lastAssistantSeq = 0;

  // Track active skill executions by skillSlug so skill_complete can update them
  const skillMap = new Map<string, SkillStreamItem>();

  function flushAssistant(timestamp: Date) {
    if (currentAssistantContent || currentToolCalls.length > 0) {
      const id = `assistant-${lastAssistantSeq}`;
      items.push({
        kind: "message",
        id,
        message: {
          id,
          role: "assistant",
          content: currentAssistantContent,
          toolCalls: currentToolCalls.length > 0 ? [...currentToolCalls] : undefined,
          timestamp,
        },
      });
      currentAssistantContent = "";
      currentToolCalls = [];
    }
  }

  for (const event of events) {
    if (event.eventType === "input" && event.direction === "client") {
      flushAssistant(new Date(event.createdAt));

      const id = `user-${event.seq}`;
      items.push({
        kind: "message",
        id,
        message: {
          id,
          role: "user",
          content: toDisplayText(event.payload.data),
          timestamp: new Date(event.createdAt),
        },
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
      const id = `system-${event.seq}`;

      items.push({
        kind: "message",
        id,
        message: {
          id,
          role: "system",
          content: `Session ${status}${reasonSuffix}`,
          timestamp: new Date(event.createdAt),
        },
      });
    }

    if (event.eventType === "error") {
      const message = toDisplayText(event.payload.message) || "Unknown error";
      const id = `error-${event.seq}`;

      items.push({
        kind: "message",
        id,
        message: {
          id,
          role: "system",
          content: `Error: ${message}`,
          timestamp: new Date(event.createdAt),
        },
      });
    }

    if (event.eventType === "transcript") {
      const transcriptTypeRaw = toDisplayText(event.payload.type);
      const transcriptType =
        transcriptTypeRaw === "user" ? "user" : "assistant";
      const transcriptText = toDisplayText(event.payload.text);
      const id = `transcript-${event.seq}`;

      items.push({
        kind: "message",
        id,
        message: {
          id,
          role: transcriptType,
          content: transcriptText,
          timestamp: new Date(
            timestampForTranscript(event.payload.timestamp, event.createdAt),
          ),
        },
      });
    }

    // Skill execution events
    if (event.eventType === "skill_start") {
      // Flush any pending assistant content before the skill block
      flushAssistant(new Date(event.createdAt));

      const slug = toDisplayText(event.payload.skillSlug) || "unknown";
      const id = `skill-${slug}-${event.seq}`;
      const skillItem: SkillStreamItem = {
        kind: "skill",
        id,
        props: {
          skillSlug: slug,
          skillName: toDisplayText(event.payload.skillName) || undefined,
          category: toDisplayText(event.payload.category) || undefined,
          status: "running",
          input: event.payload.input as Record<string, unknown> | undefined,
        },
      };
      skillMap.set(slug, skillItem);
      items.push(skillItem);
    }

    if (event.eventType === "skill_complete") {
      const slug = toDisplayText(event.payload.skillSlug) || "unknown";
      const existing = skillMap.get(slug);
      if (existing) {
        // Update the existing skill item in place
        const rawStatus = toDisplayText(event.payload.status);
        existing.props.status =
          rawStatus === "failed"
            ? "failed"
            : rawStatus === "cancelled"
              ? "cancelled"
              : "completed";
        existing.props.output = event.payload.output as Record<string, unknown> | undefined;
        existing.props.durationMs =
          typeof event.payload.durationMs === "number"
            ? event.payload.durationMs
            : undefined;
        existing.props.findings = Array.isArray(event.payload.findings)
          ? (event.payload.findings as SkillExecutionBlockProps["findings"])
          : undefined;
        existing.props.childExecutions = Array.isArray(event.payload.childExecutions)
          ? (event.payload.childExecutions as SkillExecutionBlockProps["childExecutions"])
          : undefined;
        skillMap.delete(slug);
      } else {
        // No matching start — render a standalone completed block
        const rawStatus = toDisplayText(event.payload.status);
        const id = `skill-${slug}-${event.seq}`;
        items.push({
          kind: "skill",
          id,
          props: {
            skillSlug: slug,
            skillName: toDisplayText(event.payload.skillName) || undefined,
            category: toDisplayText(event.payload.category) || undefined,
            status:
              rawStatus === "failed"
                ? "failed"
                : rawStatus === "cancelled"
                  ? "cancelled"
                  : "completed",
            output: event.payload.output as Record<string, unknown> | undefined,
            durationMs:
              typeof event.payload.durationMs === "number"
                ? event.payload.durationMs
                : undefined,
            findings: Array.isArray(event.payload.findings)
              ? (event.payload.findings as SkillExecutionBlockProps["findings"])
              : undefined,
            childExecutions: Array.isArray(event.payload.childExecutions)
              ? (event.payload.childExecutions as SkillExecutionBlockProps["childExecutions"])
              : undefined,
          },
        });
      }
    }
  }

  if (currentAssistantContent || currentToolCalls.length > 0) {
    const id = `assistant-${lastAssistantSeq}`;
    items.push({
      kind: "message",
      id,
      message: {
        id,
        role: "assistant",
        content: currentAssistantContent,
        toolCalls: currentToolCalls.length > 0 ? [...currentToolCalls] : undefined,
        timestamp: new Date(),
        isStreaming: true,
      },
    });
  }

  return items;
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

const IMAGE_URL_REGEX = /(?:\/uploads\/chat\/[^\s]+|https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp))/gi;

function extractImageUrls(content: string): string[] {
  return content.match(IMAGE_URL_REGEX) ?? [];
}

function stripImageUrls(content: string): string {
  return content.replace(IMAGE_URL_REGEX, "").trim();
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return <div className="chat-systemMessage">{message.content}</div>;
  }

  const isUser = message.role === "user";
  const roleLabel = isUser ? "You" : "Agent";
  const imageUrls = extractImageUrls(message.content);
  const textContent = imageUrls.length > 0 ? stripImageUrls(message.content) : message.content;

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
        {textContent && <div className="chat-messageText">{textContent}</div>}

        {imageUrls.map((url) => (
          <ImageMessage
            key={url}
            url={url}
            filename={url.split("/").pop()}
          />
        ))}

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
  const streamItems = parseEventsToStream(events);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [streamItems.length]);

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

      {streamItems.length === 0 ? (
        <div className="chat-emptyState">
          <div>
            <div className="chat-emptyStateTitle">Start a conversation</div>
            <div className="chat-emptyStateSubtext">
              Type a message below to begin
            </div>
          </div>
        </div>
      ) : (
        streamItems.map((item) =>
          item.kind === "skill" ? (
            <SkillExecutionBlock key={item.id} {...item.props} />
          ) : (
            <MessageBubble key={item.id} message={item.message} />
          ),
        )
      )}
    </div>
  );
}
