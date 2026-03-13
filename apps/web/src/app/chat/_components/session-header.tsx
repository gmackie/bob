"use client";

import React from "react";
import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

import type { SessionStatus } from "~/hooks/use-session-socket";

interface LinkedPullRequest {
  id: string;
  number: number;
  title: string;
  status: string;
  url: string;
}

interface LinkedTask {
  id: string;
  identifier: string;
  title?: string;
  url?: string;
}

export type WorkflowStatus =
  | "started"
  | "working"
  | "awaiting_input"
  | "blocked"
  | "awaiting_review"
  | "completed";

export interface WorkflowState {
  workflowStatus: WorkflowStatus;
  statusMessage?: string | null;
  awaitingInput?: {
    question: string;
    options?: string[] | null;
    defaultAction: string;
    expiresAt: string;
  } | null;
}

interface SessionHeaderProps {
  title: string;
  status: SessionStatus;
  agentType: string;
  issueManaged?: boolean;
  workingDirectory?: string;
  gitBranch?: string;
  linkedPr?: LinkedPullRequest | null;
  linkedTask?: LinkedTask | null;
  workflowState?: WorkflowState | null;
  voiceStatus?: "disconnected" | "connecting" | "connected" | "error";
  onStop?: () => void;
  onRestart?: () => void;
  onRename?: () => void;
}

const statusLabelMap: Record<SessionStatus, string> = {
  provisioning: "Provisioning",
  starting: "Starting",
  running: "Running",
  idle: "Idle",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Error",
};

const statusChipClassMap: Record<SessionStatus, string> = {
  provisioning: "chat-chip--provisioning",
  starting: "chat-chip--starting",
  running: "chat-chip--running",
  idle: "chat-chip--idle",
  stopping: "chat-chip--stopping",
  stopped: "chat-chip--stopped",
  error: "chat-chip--error",
};

const prStatusClassMap: Record<string, string> = {
  draft: "chat-chip--default",
  open: "chat-chip--green",
  merged: "chat-chip--purple",
  closed: "chat-chip--error",
};

const workflowStatusClassMap: Record<WorkflowStatus, string> = {
  started: "chat-chip--blue",
  working: "chat-chip--green",
  awaiting_input: "chat-chip--amber",
  blocked: "chat-chip--error",
  awaiting_review: "chat-chip--purple",
  completed: "chat-chip--green",
};

const workflowStatusLabelMap: Record<WorkflowStatus, string> = {
  started: "Started",
  working: "Working",
  awaiting_input: "Awaiting Input",
  blocked: "Blocked",
  awaiting_review: "Awaiting Review",
  completed: "Completed",
};

const statusDotClassMap: Record<SessionStatus, string> = {
  provisioning: "chat-statusDot--blue",
  starting: "chat-statusDot--blue",
  running: "chat-statusDot--green",
  idle: "chat-statusDot--yellow",
  stopping: "chat-statusDot--blue",
  stopped: "chat-statusDot--gray",
  error: "chat-statusDot--red",
};

const voiceDotClassMap: Record<
  "disconnected" | "connecting" | "connected" | "error",
  string
> = {
  disconnected: "chat-statusDot--gray",
  connecting: "chat-statusDot--green chat-statusDot--pulse",
  connected: "chat-statusDot--green chat-statusDot--pulse",
  error: "chat-statusDot--red",
};

function StatusBadge({ status }: { status: SessionStatus }) {
  const isAnimated =
    status === "provisioning" || status === "starting" || status === "stopping";

  return (
    <span
      data-testid="session-status-badge"
      data-status={status}
      className={cn("chat-chip", statusChipClassMap[status])}
    >
      <span
        className={cn(
          "chat-statusDot",
          statusDotClassMap[status],
          isAnimated && "chat-statusDot--pulse",
        )}
      />
      {statusLabelMap[status]}
    </span>
  );
}

function PrBadge({ pr }: { pr: LinkedPullRequest }) {
  const badgeClass = prStatusClassMap[pr.status] ?? "chat-chip--green";

  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "chat-prBadge chat-chip",
        badgeClass,
      )}
      title={pr.title}
    >
      <svg className="chat-iconSmall" viewBox="0 0 16 16" fill="currentColor">
        <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
      </svg>
      #{pr.number}
    </a>
  );
}

function WorkflowStatusBadge({ state }: { state: WorkflowState }) {
  const isAnimated =
    state.workflowStatus === "working" ||
    state.workflowStatus === "awaiting_input";

  return (
    <span
      data-testid="workflow-status-badge"
      data-workflow-status={state.workflowStatus}
      className={cn(
        "chat-chip",
        workflowStatusClassMap[state.workflowStatus],
      )}
      title={state.statusMessage ?? undefined}
    >
      {state.workflowStatus === "working" && (
        <svg
          className={cn("chat-iconSmall", isAnimated && "chat-iconSpin")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" opacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
      )}
      {state.workflowStatus === "awaiting_input" && (
        <svg
          className={cn("chat-iconSmall", isAnimated && "chat-iconPulse")}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-14a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
        </svg>
      )}
      {state.workflowStatus === "blocked" && (
        <svg className="chat-iconSmall" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z" />
        </svg>
      )}
      {state.workflowStatus === "awaiting_review" && (
        <svg className="chat-iconSmall" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
        </svg>
      )}
      {state.workflowStatus === "completed" && (
        <svg className="chat-iconSmall" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
      )}
      {state.workflowStatus === "started" && (
        <svg className="chat-iconSmall" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3 2a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V8.414l-5 4.293V3.707L4 8V3a1 1 0 00-1-1zm9 10H5.414l2.293-2.293-1.414-1.414L3 11V4h9v8z" />
        </svg>
      )}
      {workflowStatusLabelMap[state.workflowStatus]}
    </span>
  );
}

function TaskBadge({ task }: { task: LinkedTask }) {
  const content = (
    <span className={cn("chat-chip chat-chip--blue")}>
      <svg className="chat-iconSmall" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0113.25 15H2.75A1.75 1.75 0 011 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H2.75zM7.25 8a.75.75 0 01.75-.75h2.25a.75.75 0 010 1.5H8a.75.75 0 01-.75-.75zm.75 2.25a.75.75 0 000 1.5h2.25a.75.75 0 000-1.5H8zM5.5 6.5a1 1 0 100-2 1 1 0 000 2zm0 3a1 1 0 100-2 1 1 0 000 2zm1 2.5a1 1 0 11-2 0 1 1 0 012 0z" />
      </svg>
      {task.identifier}
    </span>
  );

  if (task.url) {
    return (
      <a
        href={task.url}
        target="_blank"
        rel="noopener noreferrer"
        className="chat-taskLink"
        title={task.title ?? task.identifier}
      >
        {content}
      </a>
    );
  }

  return content;
}

function VoiceStatusBadge({
  status,
}: {
  status: "disconnected" | "connecting" | "connected" | "error";
}) {
  const statusLabel =
    status === "connected"
      ? "Voice On"
      : status === "connecting"
        ? "Connecting..."
        : status === "error"
          ? "Voice Error"
          : "Voice Off";

  const title =
    status === "connected"
      ? "Voice On"
      : status === "connecting"
        ? "Connecting..."
        : status === "error"
          ? "Voice Error"
          : "Voice Off";

  return (
    <span
      className={cn(
        "chat-chip",
        status === "disconnected"
          ? "chat-chip--default"
          : status === "connecting"
            ? "chat-chip--blue"
            : status === "connected"
              ? "chat-chip--green"
              : "chat-chip--error",
      )}
      title={`Voice status: ${title}`}
    >
      <span
        className={cn(
          "chat-statusDot",
          voiceDotClassMap[status],
        )}
      />
      {statusLabel}
    </span>
  );
}

export function SessionHeader({
  title,
  status,
  agentType,
  issueManaged,
  workingDirectory,
  gitBranch,
  linkedPr,
  linkedTask,
  workflowState,
  voiceStatus,
  onStop,
  onRestart,
  onRename,
}: SessionHeaderProps) {
  const canStop = status === "running" || status === "idle";
  const canRestart = status === "stopped" || status === "error";

  return (
    <div data-testid="session-header" className="chat-sessionHeader">
      <div className="chat-sessionHeaderMeta chat-sessionHeaderMetaContainer">
        <div className="chat-sessionHeaderTopline">
          <h1 data-testid="session-title" className="chat-title">
            {title}
          </h1>
          <div className="chat-sessionHeaderBadges">
            <StatusBadge status={status} />
            {voiceStatus && agentType === "elevenlabs" && (
              <VoiceStatusBadge status={voiceStatus} />
            )}
            {workflowState && <WorkflowStatusBadge state={workflowState} />}
            {linkedPr && <PrBadge pr={linkedPr} />}
            {linkedTask && <TaskBadge task={linkedTask} />}
          </div>
        </div>

        <div className="chat-sessionHeaderMetaRow">
          <span className="chat-agentPill">{agentType}</span>
          {issueManaged && (
            <>
              <span>·</span>
              <span className="chat-sessionHeaderMetaValue">
                Issue-managed session
              </span>
            </>
          )}
          {gitBranch && (
            <>
              <span>·</span>
              <span className="chat-inlineIconRow">
                <svg className="chat-iconSmall" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M9.5 3.25a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zm-6 0a.75.75 0 100 1.5.75.75 0 000-1.5zm8.25.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
                </svg>
                <code className="chat-sessionHeaderCode">{gitBranch}</code>
              </span>
            </>
          )}
          {workingDirectory && (
            <>
              <span>·</span>
              <span className="chat-sessionHeaderMetaValue">from</span>
              <span
                className="chat-sessionHeaderMetaValue chat-sessionHeaderMetaValue--path chat-textTruncate"
                title={workingDirectory}
              >
                {workingDirectory}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="chat-sessionHeaderActions">
        {linkedTask?.url && (
          <Button
            asChild
            type="button"
            variant="outline"
            size="sm"
            className="chat-headerAction"
          >
            <a
              href={linkedTask.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open work item
            </a>
          </Button>
        )}

        {onRename && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="chat-headerAction"
            onClick={onRename}
          >
            Rename
          </Button>
        )}

        {canStop && onStop && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="chat-headerAction chat-headerAction--danger"
            onClick={onStop}
          >
            Stop
          </Button>
        )}

        {canRestart && onRestart && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="chat-headerAction"
            onClick={onRestart}
          >
            Restart
          </Button>
        )}
      </div>
    </div>
  );
}

interface ConnectionIndicatorProps {
  status:
    | "disconnected"
    | "connecting"
    | "authenticating"
    | "connected"
    | "error";
  error?: string;
  reconnectAttempt?: number;
  reconnectIn?: number;
  onReconnect?: () => void;
}

export function ConnectionIndicator({
  status,
  error,
  reconnectAttempt,
  reconnectIn,
  onReconnect,
}: ConnectionIndicatorProps) {
  if (status === "connected") return null;

  const getLabel = () => {
    if (status === "connecting") return "Connecting...";
    if (status === "authenticating") return "Authenticating...";
    if (status === "error") return error ?? "Connection error";
    return reconnectIn
      ? `Reconnecting in ${reconnectIn}s (attempt ${(reconnectAttempt ?? 0) + 1})`
      : "Disconnected";
  };

  return (
    <div
      className={cn(
        "chat-connectionBar",
        status === "connecting" && "chat-connectionBar--connecting",
        status === "authenticating" && "chat-connectionBar--connecting",
        status === "error" && "chat-connectionBar--error",
      )}
    >
      {(status === "connecting" ||
        status === "authenticating" ||
        status === "error") && (
        <span
          className={cn(
            "chat-connectionDot",
            status === "error" && "is-error",
          )}
        />
      )}
      <span>{getLabel()}</span>
      {status === "error" && onReconnect && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="chat-headerAction chat-headerAction--danger"
          onClick={onReconnect}
        >
          Retry
        </Button>
      )}
    </div>
  );
}
