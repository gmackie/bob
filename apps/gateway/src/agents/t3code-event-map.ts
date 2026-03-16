// T3 Code domain event types (based on t3code/packages/contracts)

export interface T3ConversationTextDelta {
  type: "conversation.textDelta";
  threadId: string;
  content: string;
}

export interface T3ConversationToolCall {
  type: "conversation.toolCall";
  threadId: string;
  toolCallId: string;
  name: string;
  arguments: string;
}

export interface T3ConversationToolResult {
  type: "conversation.toolResult";
  threadId: string;
  toolCallId: string;
  result: string;
  isError: boolean;
}

export interface T3SessionStatusChange {
  type: "session.statusChange";
  threadId: string;
  status: "running" | "idle" | "stopped" | "error";
}

export interface T3ConversationUserMessage {
  type: "conversation.userMessage";
  threadId: string;
  content: string;
}

export type T3DomainEvent =
  | T3ConversationTextDelta
  | T3ConversationToolCall
  | T3ConversationToolResult
  | T3SessionStatusChange
  | T3ConversationUserMessage;

// --- Bob → T3 Code mapping ---

import type { ServerEvent, SessionEventType, EventDirection } from "../ws/protocol.js";

/**
 * Convert a Bob ServerEvent to a T3 Code domain event.
 * Returns null if the event has no T3 equivalent.
 */
export function bobEventToT3(event: ServerEvent, threadId: string): T3DomainEvent | null {
  switch (event.eventType) {
    case "output_chunk":
      if (event.direction !== "agent") return null;
      return {
        type: "conversation.textDelta",
        threadId,
        content: (event.payload as Record<string, unknown>)?.data as string ?? "",
      };
    case "tool_call":
      return {
        type: "conversation.toolCall",
        threadId,
        toolCallId: (event.payload as Record<string, unknown>)?.toolCallId as string ?? "",
        name: (event.payload as Record<string, unknown>)?.name as string ?? "",
        arguments: (event.payload as Record<string, unknown>)?.arguments as string ?? "{}",
      };
    case "tool_result":
      return {
        type: "conversation.toolResult",
        threadId,
        toolCallId: (event.payload as Record<string, unknown>)?.toolCallId as string ?? "",
        result: (event.payload as Record<string, unknown>)?.result as string ?? "",
        isError: (event.payload as Record<string, unknown>)?.isError as boolean ?? false,
      };
    case "state":
      return {
        type: "session.statusChange",
        threadId,
        status: mapStatus((event.payload as Record<string, unknown>)?.status as string),
      };
    case "input":
      if (event.direction !== "client") return null;
      return {
        type: "conversation.userMessage",
        threadId,
        content: (event.payload as Record<string, unknown>)?.data as string ?? "",
      };
    default:
      return null;
  }
}

function mapStatus(bobStatus: string): "running" | "idle" | "stopped" | "error" {
  switch (bobStatus) {
    case "running":
      return "running";
    case "idle":
      return "idle";
    case "stopped":
    case "stopping":
      return "stopped";
    case "error":
      return "error";
    default:
      return "running";
  }
}

// --- T3 Code → Bob mapping ---

/**
 * Convert a T3 Code domain event to a partial Bob event shape.
 * Returns null if the event has no Bob equivalent.
 */
export function t3EventToBob(
  event: T3DomainEvent,
): { eventType: SessionEventType; direction: EventDirection; payload: Record<string, unknown> } | null {
  switch (event.type) {
    case "conversation.textDelta":
      return {
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: event.content },
      };
    case "conversation.toolCall":
      return {
        eventType: "tool_call",
        direction: "agent",
        payload: {
          toolCallId: event.toolCallId,
          name: event.name,
          arguments: event.arguments,
        },
      };
    case "conversation.toolResult":
      return {
        eventType: "tool_result",
        direction: "agent",
        payload: {
          toolCallId: event.toolCallId,
          result: event.result,
          isError: event.isError,
        },
      };
    case "conversation.userMessage":
      return {
        eventType: "input",
        direction: "client",
        payload: { data: event.content },
      };
    case "session.statusChange":
      return {
        eventType: "state",
        direction: "system",
        payload: { status: event.status },
      };
    default:
      return null;
  }
}
