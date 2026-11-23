/**
 * One session, summarised for a person who was not watching.
 *
 * The gateway streams every event a run produces; the phone rendered that
 * stream and nothing else, so reviewing an autonomous session meant scrolling
 * hundreds of tool calls to find out whether it finished, what it said last,
 * and whether it was waiting on you. Nothing server-side produces a summary,
 * so this folds the stream into one: a status, a headline, the agent's last
 * full message, what needs a decision, the checks, and the moments that
 * mattered (status changes, approvals, errors, messages) with the chatter
 * left out.
 *
 * Pure so it can be tested without a socket, and shared so the phone summary
 * and the tablet's side panel cannot disagree about a session.
 */

import type { CheckRow } from "~/features/runs/live-checks-model";
import { extractSessionEventText } from "~/features/chat/session-event-text";
import { foldCheckEvents } from "~/features/runs/live-checks-model";
import { formatStatusLabel } from "~/features/tablet/queue";
import { timestampToMillis } from "~/lib/timestamps";

export interface SummarySessionInput {
  sessionId: string;
  status?: string | null;
  title?: string | null;
  agentType?: string | null;
  workItemId?: string | null;
  workItemIdentifier?: string | null;
  lastActivityAt?: string | Date | null;
  lastError?: { code?: string; message?: string } | null;
}

export interface SummaryEventLike {
  seq: number;
  eventType: string;
  direction: string;
  payload: Record<string, unknown>;
  createdAt?: string | null;
}

export interface SummaryAwaitingInput {
  question: string;
  options: readonly string[] | null;
  defaultAction: string;
  expiresAt: string | Date | null;
}

export interface SummaryWorkflowState {
  workflowStatus: string;
  statusMessage: string | null;
  awaitingInput: SummaryAwaitingInput | null;
}

export interface SummaryRunInput {
  status?: string | null;
  summary?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
}

/**
 * What the status means to a person, not what the runner called it.
 * `attention` is the one that matters: the agent is paused on you.
 */
export type SessionSummaryTone =
  | "running"
  | "attention"
  | "success"
  | "failure"
  | "idle";

export type SessionKeyMomentKind =
  | "status"
  | "workflow"
  | "permission"
  | "error"
  | "message"
  | "input"
  | "check";

export interface SessionKeyMoment {
  id: string;
  seq: number;
  kind: SessionKeyMomentKind;
  label: string;
  text: string;
  tone: SessionSummaryTone | "neutral";
  at: string | null;
}

export interface SessionPendingPermission {
  requestId: string;
  toolName?: string;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  identifier: string | null;
  agentLabel: string;
  status: string;
  statusLabel: string;
  tone: SessionSummaryTone;
  isActive: boolean;
  /** One line: what it is doing now, or how it ended. */
  headline: string;
  /** The agent's most recent complete message, for reading rather than skimming. */
  latestMessage: string | null;
  pendingPermission: SessionPendingPermission | null;
  awaitingInput: SummaryAwaitingInput | null;
  error: string | null;
  pullRequestUrl: string | null;
  branch: string | null;
  elapsedLabel: string | null;
  lastActivityLabel: string | null;
  counts: {
    toolCalls: number;
    messages: number;
    errors: number;
    filesEdited: number;
  };
  checks: CheckRow[];
  keyMoments: SessionKeyMoment[];
}

export interface BuildSessionSummaryInput {
  session: SummarySessionInput | null | undefined;
  sessionId: string;
  events: readonly SummaryEventLike[];
  workflowState?: SummaryWorkflowState | null;
  run?: SummaryRunInput | null;
}

const ACTIVE_STATUSES = new Set([
  "provisioning",
  "starting",
  "running",
  "queued",
  "pending",
  "stopping",
  "blocked",
  "awaiting_input",
  "awaiting-input",
  "host_unknown",
]);
const ATTENTION_STATUSES = new Set([
  "blocked",
  "awaiting_input",
  "awaiting-input",
  "host_unknown",
]);
const SUCCESS_STATUSES = new Set(["completed", "done"]);
const FAILURE_STATUSES = new Set(["failed", "error", "interrupted"]);

const EDIT_TOOLS = new Set([
  "write",
  "edit",
  "multiedit",
  "notebookedit",
  "apply_patch",
  "create_file",
  "str_replace_editor",
  "str_replace_based_edit_tool",
]);

const LATEST_MESSAGE_LIMIT = 2_000;
const HEADLINE_LIMIT = 160;
const MOMENT_TEXT_LIMIT = 220;
export const KEY_MOMENT_LIMIT = 24;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const MARKDOWN_LINE_PREFIX = /^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/;

function stripMarkdownPrefix(line: string): string {
  return line.replace(MARKDOWN_LINE_PREFIX, "").replace(/\*\*(.+?)\*\*/g, "$1");
}

/**
 * The first line a person would read. Markdown markers are noise in a
 * one-liner, and a message that opens with a heading ("## Summary") says
 * nothing on its own, so the heading is folded into the line beneath it.
 */
function firstLine(value: string, limit: number): string {
  const lines = value
    .trim()
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const [first = "", second] = lines;
  const isHeading = /^#{1,6}\s+/.test(first);
  const lead = stripMarkdownPrefix(first);
  const body =
    isHeading && second ? `${lead}: ${stripMarkdownPrefix(second)}` : lead;
  const collapsed = body.replace(/\s+/g, " ").trim();
  return collapsed.length > limit
    ? `${collapsed.slice(0, limit - 1).trimEnd()}…`
    : collapsed;
}

function clip(value: string, limit: number): string {
  const trimmed = value.trim();
  return trimmed.length > limit
    ? `${trimmed.slice(0, limit - 1).trimEnd()}…`
    : trimmed;
}

function toMillis(value: unknown): number | null {
  return timestampToMillis(value as string | number | Date | null | undefined);
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatRelative(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function toneForStatus(status: string): SessionSummaryTone {
  const normalized = status.toLowerCase();
  if (ATTENTION_STATUSES.has(normalized)) return "attention";
  if (ACTIVE_STATUSES.has(normalized)) return "running";
  if (SUCCESS_STATUSES.has(normalized)) return "success";
  if (FAILURE_STATUSES.has(normalized)) return "failure";
  return "idle";
}

export function isActiveSessionStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status.toLowerCase());
}

/**
 * The newest permission_request without a permission_resolved. Once the run
 * leaves "blocked" any lingering request is stale, because status_change
 * events are always replayed even when chatty output is truncated.
 */
export function derivePendingPermission(
  events: readonly SummaryEventLike[],
): SessionPendingPermission | null {
  const resolved = new Set<string>();
  let latestRunStatus: string | undefined;
  for (const event of events) {
    if (event.eventType === "permission_resolved") {
      const requestId = text(event.payload.requestId);
      if (requestId) resolved.add(requestId);
    } else if (event.eventType === "status_change") {
      const status = text(event.payload.status);
      if (status) latestRunStatus = status;
    }
  }
  if (latestRunStatus !== undefined && latestRunStatus !== "blocked") {
    return null;
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.eventType !== "permission_request") continue;
    const requestId = text(event.payload.requestId);
    if (requestId && !resolved.has(requestId)) {
      const toolName = text(event.payload.toolName);
      return toolName ? { requestId, toolName } : { requestId };
    }
  }
  return null;
}

/** The run's own status, as last reported through the durable status_change row. */
function latestStatusChange(
  events: readonly SummaryEventLike[],
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.eventType !== "status_change") continue;
    const status = text(event.payload.status);
    if (status) return status;
  }
  return null;
}

function latestWorkflowMessage(events: readonly SummaryEventLike[]): {
  workflowStatus: string;
  message: string;
  prUrl: string | null;
} | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.eventType !== "state") continue;
    if (event.payload.type !== "workflow_status") continue;
    const details = record(event.payload.details);
    return {
      workflowStatus: text(event.payload.workflowStatus),
      message: text(event.payload.message),
      prUrl: text(details?.prUrl) || null,
    };
  }
  return null;
}

function latestAgentMessage(
  events: readonly SummaryEventLike[],
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.eventType !== "message_final") continue;
    const body = extractSessionEventText(event.eventType, event.payload).trim();
    if (body) return clip(body, LATEST_MESSAGE_LIMIT);
  }
  return null;
}

function latestToolCall(events: readonly SummaryEventLike[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.eventType !== "tool_call") continue;
    const body = extractSessionEventText(event.eventType, event.payload).trim();
    if (body) return body;
  }
  return null;
}

function latestError(
  events: readonly SummaryEventLike[],
  session: SummarySessionInput | null | undefined,
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.eventType !== "error") continue;
    const body = extractSessionEventText(event.eventType, event.payload).trim();
    if (body) return clip(body, MOMENT_TEXT_LIMIT);
  }
  const sessionError = session?.lastError;
  if (sessionError?.message) {
    return clip(
      [sessionError.code, sessionError.message].filter(Boolean).join(": "),
      MOMENT_TEXT_LIMIT,
    );
  }
  return null;
}

function editedFilePaths(events: readonly SummaryEventLike[]): Set<string> {
  const paths = new Set<string>();
  for (const event of events) {
    if (event.eventType !== "tool_call") continue;
    const name = text(event.payload.name).toLowerCase();
    if (!EDIT_TOOLS.has(name)) continue;
    let args = record(event.payload.arguments);
    if (!args && typeof event.payload.arguments === "string") {
      try {
        args = record(JSON.parse(event.payload.arguments));
      } catch {
        args = null;
      }
    }
    const path = text(args?.file_path) || text(args?.path);
    if (path) paths.add(path);
  }
  return paths;
}

function pullRequestFromEvents(
  events: readonly SummaryEventLike[],
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event) continue;
    if (event.eventType === "state") {
      const details = record(event.payload.details);
      const url = text(details?.prUrl);
      if (url) return url;
    }
    if (event.eventType === "status_change") {
      const summary = record(event.payload.summary);
      const url = text(summary?.pullRequestUrl);
      if (url) return url;
    }
  }
  return null;
}

function branchFromEvents(events: readonly SummaryEventLike[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.eventType !== "status_change") continue;
    const summary = record(event.payload.summary);
    const branch = text(summary?.branch);
    if (branch) return branch;
  }
  return null;
}

function momentTone(
  kind: SessionKeyMomentKind,
  status?: string,
): SessionKeyMoment["tone"] {
  if (kind === "error") return "failure";
  if (kind === "permission") return "attention";
  if (kind === "status" && status) return toneForStatus(status);
  if (kind === "workflow" && status) {
    if (status === "completed" || status === "awaiting_review")
      return "success";
    if (status === "blocked" || status === "awaiting_input") return "attention";
  }
  if (kind === "check") return "failure";
  return "neutral";
}

/**
 * The events a reviewer would stop on. Output chunks, tool calls and results
 * are what the thread view is for; here they would bury the three status
 * changes and one approval that tell the story.
 */
export function buildKeyMoments(
  events: readonly SummaryEventLike[],
  limit = KEY_MOMENT_LIMIT,
): SessionKeyMoment[] {
  const moments: SessionKeyMoment[] = [];
  const push = (
    event: SummaryEventLike,
    kind: SessionKeyMomentKind,
    label: string,
    body: string,
    tone: SessionKeyMoment["tone"],
  ) => {
    const clipped = clip(body, MOMENT_TEXT_LIMIT);
    if (!clipped) return;
    moments.push({
      id: `${event.seq}-${kind}`,
      seq: event.seq,
      kind,
      label,
      text: clipped,
      tone,
      at: event.createdAt ?? null,
    });
  };

  for (const event of events) {
    switch (event.eventType) {
      case "status_change": {
        const status = text(event.payload.status);
        if (!status) break;
        const summary = record(event.payload.summary);
        const reason =
          text(summary?.reason) ||
          text(summary?.reap_reason) ||
          text(summary?.reconcile_reason);
        push(
          event,
          "status",
          "Status",
          reason
            ? `${formatStatusLabel(status)} — ${reason}`
            : formatStatusLabel(status),
          momentTone("status", status),
        );
        break;
      }
      case "state": {
        if (event.payload.type !== "workflow_status") break;
        const workflowStatus = text(event.payload.workflowStatus);
        const message = text(event.payload.message);
        push(
          event,
          "workflow",
          formatStatusLabel(workflowStatus || "update"),
          message || formatStatusLabel(workflowStatus),
          momentTone("workflow", workflowStatus),
        );
        break;
      }
      case "permission_request": {
        const toolName = text(event.payload.toolName);
        push(
          event,
          "permission",
          "Approval requested",
          toolName ? `Wants to use ${toolName}` : "Waiting for your approval",
          momentTone("permission"),
        );
        break;
      }
      case "permission_resolved": {
        const decision = text(event.payload.decision);
        push(
          event,
          "permission",
          "Approval resolved",
          decision === "deny"
            ? "Denied"
            : decision === "allow"
              ? "Approved"
              : "Resolved",
          "neutral",
        );
        break;
      }
      case "error": {
        push(
          event,
          "error",
          "Error",
          extractSessionEventText(event.eventType, event.payload) ||
            "Unknown error",
          momentTone("error"),
        );
        break;
      }
      case "message_final": {
        const body = extractSessionEventText(event.eventType, event.payload);
        push(
          event,
          "message",
          "Agent",
          firstLine(body, MOMENT_TEXT_LIMIT),
          "neutral",
        );
        break;
      }
      case "input": {
        if (event.direction !== "client") break;
        const body = extractSessionEventText(event.eventType, event.payload);
        push(
          event,
          "input",
          "You",
          firstLine(body, MOMENT_TEXT_LIMIT),
          "neutral",
        );
        break;
      }
      case "check": {
        if (text(event.payload.status) !== "failed") break;
        const phase = text(event.payload.phase);
        if (!phase || phase === "all") break;
        const counts = record(event.payload.counts);
        const failed =
          typeof counts?.failed === "number" ? counts.failed : null;
        push(
          event,
          "check",
          "Check failed",
          failed !== null ? `${phase}: ${failed} failed` : phase,
          momentTone("check"),
        );
        break;
      }
      default:
        break;
    }
  }

  return moments.slice(-limit);
}

function resolveStatus(
  session: SummarySessionInput | null | undefined,
  events: readonly SummaryEventLike[],
  run: SummaryRunInput | null | undefined,
): string {
  // The live gateway status wins: it is what the sidebar and pushes use. The
  // durable status_change row is next, because it survives reconnects. The run
  // record is last, since it is only reconciled after the fact.
  return (
    nonEmpty(session?.status) ??
    latestStatusChange(events) ??
    nonEmpty(run?.status) ??
    "unknown"
  );
}

export function buildSessionSummary(
  input: BuildSessionSummaryInput,
  options: { now?: Date } = {},
): SessionSummary {
  const now = options.now ?? new Date();
  const { session, events, workflowState, run } = input;
  const sessionId = session?.sessionId ?? input.sessionId;

  const status = resolveStatus(session, events, run);
  const isActive = isActiveSessionStatus(status);
  const pendingPermission = isActive ? derivePendingPermission(events) : null;
  const awaitingInput = isActive
    ? (workflowState?.awaitingInput ?? null)
    : null;
  let tone = toneForStatus(status);
  if (pendingPermission || awaitingInput) tone = "attention";

  const error = latestError(events, session);
  const workflow = latestWorkflowMessage(events);
  const workflowMessage =
    nonEmpty(workflowState?.statusMessage) ?? nonEmpty(workflow?.message) ?? "";
  const latestMessage = latestAgentMessage(events);
  const lastTool = latestToolCall(events);

  let headline: string;
  if (pendingPermission) {
    headline = pendingPermission.toolName
      ? `Waiting for approval to use ${pendingPermission.toolName}`
      : "Waiting for your approval";
  } else if (awaitingInput) {
    headline = `Asking: ${firstLine(awaitingInput.question, HEADLINE_LIMIT)}`;
  } else if (tone === "failure" && error) {
    headline = firstLine(error, HEADLINE_LIMIT);
  } else if (status === "host_unknown") {
    headline = "Lost contact with the host; the run may still be going";
  } else if (workflowMessage) {
    headline = firstLine(workflowMessage, HEADLINE_LIMIT);
  } else if (latestMessage) {
    headline = firstLine(latestMessage, HEADLINE_LIMIT);
  } else if (isActive && lastTool) {
    headline = `Running ${firstLine(lastTool, HEADLINE_LIMIT - 8)}`;
  } else if (isActive) {
    headline = "Started, no output yet";
  } else if (tone === "failure") {
    headline = `${formatStatusLabel(status)} without a message`;
  } else {
    headline = `${formatStatusLabel(status)} without a summary`;
  }

  const runSummary = record(run?.summary);
  const pullRequestUrl =
    workflow?.prUrl ??
    pullRequestFromEvents(events) ??
    (text(runSummary?.pullRequestUrl) || null);
  const branch = text(runSummary?.branch) || branchFromEvents(events);

  const eventTimes = events
    .map((event) => toMillis(event.createdAt))
    .filter((value): value is number => value !== null);
  const firstAt =
    toMillis(run?.startedAt) ??
    (eventTimes.length ? Math.min(...eventTimes) : null);
  const lastEventAt = eventTimes.length ? Math.max(...eventTimes) : null;
  const endedAt = isActive
    ? now.getTime()
    : (toMillis(run?.completedAt) ?? lastEventAt);
  const elapsedLabel =
    firstAt !== null && endedAt !== null && endedAt >= firstAt
      ? formatElapsed(endedAt - firstAt)
      : null;
  const lastActivityAt = Math.max(
    lastEventAt ?? 0,
    toMillis(session?.lastActivityAt) ?? 0,
  );
  const lastActivityLabel =
    lastActivityAt > 0 ? formatRelative(lastActivityAt, now.getTime()) : null;

  let toolCalls = 0;
  let messages = 0;
  let errors = 0;
  for (const event of events) {
    if (event.eventType === "tool_call") toolCalls += 1;
    else if (event.eventType === "message_final") messages += 1;
    else if (event.eventType === "error") errors += 1;
    else if (event.eventType === "tool_result" && event.payload.isError)
      errors += 1;
  }

  const identifier = nonEmpty(session?.workItemIdentifier);
  const title =
    nonEmpty(session?.title) ??
    identifier ??
    `Session ${sessionId.slice(0, 8)}`;

  return {
    sessionId,
    title,
    identifier,
    agentLabel: formatStatusLabel(session?.agentType ?? "agent"),
    status,
    statusLabel: formatStatusLabel(status),
    tone,
    isActive,
    headline,
    latestMessage,
    pendingPermission,
    awaitingInput,
    error,
    pullRequestUrl,
    branch,
    elapsedLabel,
    lastActivityLabel,
    counts: {
      toolCalls,
      messages,
      errors,
      filesEdited: editedFilePaths(events).size,
    },
    checks: foldCheckEvents(events),
    keyMoments: buildKeyMoments(events),
  };
}
