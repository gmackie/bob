// T3 Code domain event types (based on t3code/packages/contracts)

type T3ThreadId = string;
type T3RunStatus = "starting" | "running" | "completed" | "failed" | "interrupted" | "cancelled";
type T3AgentStatus = "starting" | "running" | "completed" | "failed" | "blocked";

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

export interface T3ThreadMessageStarted {
  type: "thread.message.started";
  threadId: T3ThreadId;
  runId: string;
  messageId: string;
  role?: string;
}

export interface T3ThreadMessageDelta {
  type: "thread.message.delta";
  threadId: T3ThreadId;
  runId: string;
  messageId: string;
  content: string;
}

export interface T3ThreadMessageCompleted {
  type: "thread.message.completed";
  threadId: T3ThreadId;
  runId: string;
  messageId: string;
  content?: string;
}

export interface T3ThreadMessageFailed {
  type: "thread.message.failed";
  threadId: T3ThreadId;
  runId: string;
  messageId: string;
  errorMessage: string;
}

export interface T3RunStarted {
  type: "run.started";
  threadId: T3ThreadId;
  runId: string;
  status?: T3RunStatus;
}

export interface T3RunUpdated {
  type: "run.updated";
  threadId: T3ThreadId;
  runId: string;
  status?: T3RunStatus;
  detail?: string;
}

export interface T3RunCompleted {
  type: "run.completed";
  threadId: T3ThreadId;
  runId: string;
  status?: T3RunStatus;
  summary?: string;
}

export interface T3RunFailed {
  type: "run.failed";
  threadId: T3ThreadId;
  runId: string;
  status?: T3RunStatus;
  errorMessage: string;
}

export interface T3AgentSpawned {
  type: "agent.spawned";
  threadId: T3ThreadId;
  runId: string;
  agentId: string;
  label?: string;
}

export interface T3AgentUpdated {
  type: "agent.updated";
  threadId: T3ThreadId;
  runId: string;
  agentId: string;
  status?: T3AgentStatus;
  detail?: string;
}

export interface T3AgentCompleted {
  type: "agent.completed";
  threadId: T3ThreadId;
  runId: string;
  agentId: string;
  status?: T3AgentStatus;
  summary?: string;
}

export interface T3AgentFailed {
  type: "agent.failed";
  threadId: T3ThreadId;
  runId: string;
  agentId: string;
  status?: T3AgentStatus;
  errorMessage: string;
}

export interface T3AgentTaskAssigned {
  type: "agent.task.assigned";
  threadId: T3ThreadId;
  runId: string;
  agentId: string;
  taskId: string;
  title?: string;
}

export interface T3AgentTaskProgressed {
  type: "agent.task.progressed";
  threadId: T3ThreadId;
  runId: string;
  agentId: string;
  taskId: string;
  detail?: string;
}

export interface T3AgentTaskBlocked {
  type: "agent.task.blocked";
  threadId: T3ThreadId;
  runId: string;
  agentId: string;
  taskId: string;
  blocker?: string;
}

export interface T3AgentTaskCompleted {
  type: "agent.task.completed";
  threadId: T3ThreadId;
  runId: string;
  agentId: string;
  taskId: string;
  summary?: string;
}

export interface T3AgentTaskFailed {
  type: "agent.task.failed";
  threadId: T3ThreadId;
  runId: string;
  agentId: string;
  taskId: string;
  errorMessage: string;
}

export interface T3AgentTaskReassigned {
  type: "agent.task.reassigned";
  threadId: T3ThreadId;
  runId: string;
  agentId: string;
  taskId: string;
  previousAgentId?: string;
}

export interface T3RequestOpened {
  type: "request.opened";
  threadId: T3ThreadId;
  runId: string;
  requestId: string;
  requestKind?: string;
  detail?: string;
}

export interface T3RequestResolved {
  type: "request.resolved";
  threadId: T3ThreadId;
  runId: string;
  requestId: string;
  requestKind?: string;
  decision?: string;
}

export interface T3UserInputRequested {
  type: "user_input.requested";
  threadId: T3ThreadId;
  runId: string;
  requestId: string;
  question?: string;
}

export interface T3UserInputResolved {
  type: "user_input.resolved";
  threadId: T3ThreadId;
  runId: string;
  requestId: string;
  answers?: unknown[];
}

export interface T3ArtifactProduced {
  type: "artifact.produced";
  threadId: T3ThreadId;
  runId: string;
  artifactId: string;
  artifactKind?: string;
  title?: string;
}

export interface T3ArtifactUpdated {
  type: "artifact.updated";
  threadId: T3ThreadId;
  runId: string;
  artifactId: string;
  artifactKind?: string;
  title?: string;
}

export interface T3ArtifactPromoted {
  type: "artifact.promoted";
  threadId: T3ThreadId;
  runId: string;
  artifactId: string;
  artifactKind?: string;
  title?: string;
}

export interface T3LinkCreated {
  type: "link.created";
  threadId: T3ThreadId;
  runId: string;
  linkKind: string;
  sourceId: string;
  targetId: string;
}

export type T3DomainEvent =
  | T3ConversationTextDelta
  | T3ConversationToolCall
  | T3ConversationToolResult
  | T3SessionStatusChange
  | T3ConversationUserMessage
  | T3ThreadMessageStarted
  | T3ThreadMessageDelta
  | T3ThreadMessageCompleted
  | T3ThreadMessageFailed
  | T3RunStarted
  | T3RunUpdated
  | T3RunCompleted
  | T3RunFailed
  | T3AgentSpawned
  | T3AgentUpdated
  | T3AgentCompleted
  | T3AgentFailed
  | T3AgentTaskAssigned
  | T3AgentTaskProgressed
  | T3AgentTaskBlocked
  | T3AgentTaskCompleted
  | T3AgentTaskFailed
  | T3AgentTaskReassigned
  | T3RequestOpened
  | T3RequestResolved
  | T3UserInputRequested
  | T3UserInputResolved
  | T3ArtifactProduced
  | T3ArtifactUpdated
  | T3ArtifactPromoted
  | T3LinkCreated;

// --- Bob → T3 Code mapping ---

import type { ServerEvent, SessionEventType, EventDirection } from "../ws/protocol.js";

function readPayload(event: ServerEvent): Record<string, unknown> {
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function readArray(payload: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = payload[key];
  return Array.isArray(value) ? value : undefined;
}

/**
 * Convert a Bob ServerEvent to a T3 Code domain event.
 * Returns null if the event has no T3 equivalent.
 */
export function bobEventToT3(event: ServerEvent, threadId: string): T3DomainEvent | null {
  const payload = readPayload(event);

  switch (event.eventType) {
    case "output_chunk":
      if (event.direction !== "agent") return null;
      return {
        type: "conversation.textDelta",
        threadId,
        content: readString(payload, "data") ?? "",
      };
    case "tool_call":
      return {
        type: "conversation.toolCall",
        threadId,
        toolCallId: readString(payload, "toolCallId") ?? "",
        name: readString(payload, "name") ?? "",
        arguments: readString(payload, "arguments") ?? "{}",
      };
    case "tool_result":
      return {
        type: "conversation.toolResult",
        threadId,
        toolCallId: readString(payload, "toolCallId") ?? "",
        result: readString(payload, "result") ?? "",
        isError: payload.isError === true,
      };
    case "state":
      switch (readString(payload, "orchestrationType")) {
        case "thread_message_started":
          return {
            type: "thread.message.started",
            threadId,
            runId: readString(payload, "runId") ?? "",
            messageId: readString(payload, "messageId") ?? "",
            role: readString(payload, "role"),
          };
        case "thread_message_delta":
          return {
            type: "thread.message.delta",
            threadId,
            runId: readString(payload, "runId") ?? "",
            messageId: readString(payload, "messageId") ?? "",
            content: readString(payload, "content") ?? "",
          };
        case "thread_message_completed":
          return {
            type: "thread.message.completed",
            threadId,
            runId: readString(payload, "runId") ?? "",
            messageId: readString(payload, "messageId") ?? "",
            content: readString(payload, "content"),
          };
        case "thread_message_failed":
          return {
            type: "thread.message.failed",
            threadId,
            runId: readString(payload, "runId") ?? "",
            messageId: readString(payload, "messageId") ?? "",
            errorMessage: readString(payload, "errorMessage") ?? "",
          };
        case "run_started":
          return {
            type: "run.started",
            threadId,
            runId: readString(payload, "runId") ?? "",
            status: mapRunStatus(readString(payload, "status")),
          };
        case "run_updated":
          return {
            type: "run.updated",
            threadId,
            runId: readString(payload, "runId") ?? "",
            status: mapRunStatus(readString(payload, "status")),
            detail: readString(payload, "detail"),
          };
        case "run_completed":
          return {
            type: "run.completed",
            threadId,
            runId: readString(payload, "runId") ?? "",
            status: mapRunStatus(readString(payload, "status")),
            summary: readString(payload, "summary"),
          };
        case "run_failed":
          return {
            type: "run.failed",
            threadId,
            runId: readString(payload, "runId") ?? "",
            status: mapRunStatus(readString(payload, "status")),
            errorMessage: readString(payload, "errorMessage") ?? "",
          };
        case "agent_spawned":
          return {
            type: "agent.spawned",
            threadId,
            runId: readString(payload, "runId") ?? "",
            agentId: readString(payload, "agentId") ?? "",
            label: readString(payload, "label"),
          };
        case "agent_updated":
          return {
            type: "agent.updated",
            threadId,
            runId: readString(payload, "runId") ?? "",
            agentId: readString(payload, "agentId") ?? "",
            status: mapAgentStatus(readString(payload, "status")),
            detail: readString(payload, "detail"),
          };
        case "agent_completed":
          return {
            type: "agent.completed",
            threadId,
            runId: readString(payload, "runId") ?? "",
            agentId: readString(payload, "agentId") ?? "",
            status: mapAgentStatus(readString(payload, "status")),
            summary: readString(payload, "summary"),
          };
        case "agent_failed":
          return {
            type: "agent.failed",
            threadId,
            runId: readString(payload, "runId") ?? "",
            agentId: readString(payload, "agentId") ?? "",
            status: mapAgentStatus(readString(payload, "status")),
            errorMessage: readString(payload, "errorMessage") ?? "",
          };
        case "agent_task_assigned":
          return {
            type: "agent.task.assigned",
            threadId,
            runId: readString(payload, "runId") ?? "",
            agentId: readString(payload, "agentId") ?? "",
            taskId: readString(payload, "taskId") ?? "",
            title: readString(payload, "title"),
          };
        case "agent_task_progressed":
          return {
            type: "agent.task.progressed",
            threadId,
            runId: readString(payload, "runId") ?? "",
            agentId: readString(payload, "agentId") ?? "",
            taskId: readString(payload, "taskId") ?? "",
            detail: readString(payload, "detail"),
          };
        case "agent_task_blocked":
          return {
            type: "agent.task.blocked",
            threadId,
            runId: readString(payload, "runId") ?? "",
            agentId: readString(payload, "agentId") ?? "",
            taskId: readString(payload, "taskId") ?? "",
            blocker: readString(payload, "blocker"),
          };
        case "agent_task_completed":
          return {
            type: "agent.task.completed",
            threadId,
            runId: readString(payload, "runId") ?? "",
            agentId: readString(payload, "agentId") ?? "",
            taskId: readString(payload, "taskId") ?? "",
            summary: readString(payload, "summary"),
          };
        case "agent_task_failed":
          return {
            type: "agent.task.failed",
            threadId,
            runId: readString(payload, "runId") ?? "",
            agentId: readString(payload, "agentId") ?? "",
            taskId: readString(payload, "taskId") ?? "",
            errorMessage: readString(payload, "errorMessage") ?? "",
          };
        case "agent_task_reassigned":
          return {
            type: "agent.task.reassigned",
            threadId,
            runId: readString(payload, "runId") ?? "",
            agentId: readString(payload, "agentId") ?? "",
            taskId: readString(payload, "taskId") ?? "",
            previousAgentId: readString(payload, "previousAgentId"),
          };
        case "request_opened":
          return {
            type: "request.opened",
            threadId,
            runId: readString(payload, "runId") ?? "",
            requestId: readString(payload, "requestId") ?? "",
            requestKind: readString(payload, "requestKind"),
            detail: readString(payload, "detail"),
          };
        case "request_resolved":
          return {
            type: "request.resolved",
            threadId,
            runId: readString(payload, "runId") ?? "",
            requestId: readString(payload, "requestId") ?? "",
            requestKind: readString(payload, "requestKind"),
            decision: readString(payload, "decision"),
          };
        case "user_input_requested":
          return {
            type: "user_input.requested",
            threadId,
            runId: readString(payload, "runId") ?? "",
            requestId: readString(payload, "requestId") ?? "",
            question: readString(payload, "question"),
          };
        case "user_input_resolved":
          return {
            type: "user_input.resolved",
            threadId,
            runId: readString(payload, "runId") ?? "",
            requestId: readString(payload, "requestId") ?? "",
            answers: readArray(payload, "answers"),
          };
        case "artifact_produced":
          return {
            type: "artifact.produced",
            threadId,
            runId: readString(payload, "runId") ?? "",
            artifactId: readString(payload, "artifactId") ?? "",
            artifactKind: readString(payload, "artifactKind"),
            title: readString(payload, "title"),
          };
        case "artifact_updated":
          return {
            type: "artifact.updated",
            threadId,
            runId: readString(payload, "runId") ?? "",
            artifactId: readString(payload, "artifactId") ?? "",
            artifactKind: readString(payload, "artifactKind"),
            title: readString(payload, "title"),
          };
        case "artifact_promoted":
          return {
            type: "artifact.promoted",
            threadId,
            runId: readString(payload, "runId") ?? "",
            artifactId: readString(payload, "artifactId") ?? "",
            artifactKind: readString(payload, "artifactKind"),
            title: readString(payload, "title"),
          };
        case "link_created":
          return {
            type: "link.created",
            threadId,
            runId: readString(payload, "runId") ?? "",
            linkKind: readString(payload, "linkKind") ?? "",
            sourceId: readString(payload, "sourceId") ?? "",
            targetId: readString(payload, "targetId") ?? "",
          };
        default:
          break;
      }
      return {
        type: "session.statusChange",
        threadId,
        status: mapStatus(readString(payload, "status")),
      };
    case "input":
      if (event.direction !== "client") return null;
      return {
        type: "conversation.userMessage",
        threadId,
        content: readString(payload, "data") ?? "",
      };
    default:
      return null;
  }
}

function mapRunStatus(status: string | undefined): T3RunStatus | undefined {
  switch (status) {
    case "starting":
    case "running":
    case "completed":
    case "failed":
    case "interrupted":
    case "cancelled":
      return status;
    default:
      return undefined;
  }
}

function mapAgentStatus(status: string | undefined): T3AgentStatus | undefined {
  switch (status) {
    case "starting":
    case "running":
    case "completed":
    case "failed":
    case "blocked":
      return status;
    default:
      return undefined;
  }
}

function mapStatus(bobStatus: string | undefined): "running" | "idle" | "stopped" | "error" {
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
    case "thread.message.started":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "thread_message_started",
          runId: event.runId,
          messageId: event.messageId,
          role: event.role ?? "assistant",
        },
      };
    case "thread.message.delta":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "thread_message_delta",
          runId: event.runId,
          messageId: event.messageId,
          content: event.content,
        },
      };
    case "thread.message.completed":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "thread_message_completed",
          runId: event.runId,
          messageId: event.messageId,
          content: event.content,
        },
      };
    case "thread.message.failed":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "thread_message_failed",
          runId: event.runId,
          messageId: event.messageId,
          errorMessage: event.errorMessage,
        },
      };
    case "run.started":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "run_started",
          runId: event.runId,
          status: event.status ?? "running",
        },
      };
    case "run.updated":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "run_updated",
          runId: event.runId,
          status: event.status ?? "running",
          detail: event.detail,
        },
      };
    case "run.completed":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "run_completed",
          runId: event.runId,
          status: event.status ?? "completed",
          summary: event.summary,
        },
      };
    case "run.failed":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "run_failed",
          runId: event.runId,
          status: event.status ?? "failed",
          errorMessage: event.errorMessage,
        },
      };
    case "agent.spawned":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "agent_spawned",
          runId: event.runId,
          agentId: event.agentId,
          label: event.label,
        },
      };
    case "agent.updated":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "agent_updated",
          runId: event.runId,
          agentId: event.agentId,
          status: event.status ?? "running",
          detail: event.detail,
        },
      };
    case "agent.completed":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "agent_completed",
          runId: event.runId,
          agentId: event.agentId,
          status: event.status ?? "completed",
          summary: event.summary,
        },
      };
    case "agent.failed":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "agent_failed",
          runId: event.runId,
          agentId: event.agentId,
          status: event.status ?? "failed",
          errorMessage: event.errorMessage,
        },
      };
    case "agent.task.assigned":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "agent_task_assigned",
          runId: event.runId,
          agentId: event.agentId,
          taskId: event.taskId,
          title: event.title,
        },
      };
    case "agent.task.progressed":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "agent_task_progressed",
          runId: event.runId,
          agentId: event.agentId,
          taskId: event.taskId,
          detail: event.detail,
        },
      };
    case "agent.task.blocked":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "agent_task_blocked",
          runId: event.runId,
          agentId: event.agentId,
          taskId: event.taskId,
          blocker: event.blocker,
        },
      };
    case "agent.task.completed":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "agent_task_completed",
          runId: event.runId,
          agentId: event.agentId,
          taskId: event.taskId,
          summary: event.summary,
        },
      };
    case "agent.task.failed":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "agent_task_failed",
          runId: event.runId,
          agentId: event.agentId,
          taskId: event.taskId,
          errorMessage: event.errorMessage,
        },
      };
    case "agent.task.reassigned":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "agent_task_reassigned",
          runId: event.runId,
          agentId: event.agentId,
          taskId: event.taskId,
          previousAgentId: event.previousAgentId,
        },
      };
    case "request.opened":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "request_opened",
          runId: event.runId,
          requestId: event.requestId,
          requestKind: event.requestKind,
          detail: event.detail,
        },
      };
    case "request.resolved":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "request_resolved",
          runId: event.runId,
          requestId: event.requestId,
          requestKind: event.requestKind,
          decision: event.decision,
        },
      };
    case "user_input.requested":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "user_input_requested",
          runId: event.runId,
          requestId: event.requestId,
          question: event.question,
        },
      };
    case "user_input.resolved":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "user_input_resolved",
          runId: event.runId,
          requestId: event.requestId,
          answers: event.answers,
        },
      };
    case "artifact.produced":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "artifact_produced",
          runId: event.runId,
          artifactId: event.artifactId,
          artifactKind: event.artifactKind,
          title: event.title,
        },
      };
    case "artifact.updated":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "artifact_updated",
          runId: event.runId,
          artifactId: event.artifactId,
          artifactKind: event.artifactKind,
          title: event.title,
        },
      };
    case "artifact.promoted":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "artifact_promoted",
          runId: event.runId,
          artifactId: event.artifactId,
          artifactKind: event.artifactKind,
          title: event.title,
        },
      };
    case "link.created":
      return {
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "link_created",
          runId: event.runId,
          linkKind: event.linkKind,
          sourceId: event.sourceId,
          targetId: event.targetId,
        },
      };
    default:
      return null;
  }
}
