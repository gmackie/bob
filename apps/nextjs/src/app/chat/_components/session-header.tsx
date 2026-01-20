"use client";

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

const statusConfig: Record<
  SessionStatus,
  { label: string; color: string; bgColor: string }
> = {
  provisioning: {
    label: "Provisioning",
    color: "text-blue-600",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  starting: {
    label: "Starting",
    color: "text-blue-600",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  running: {
    label: "Running",
    color: "text-green-600",
    bgColor: "bg-green-100 dark:bg-green-900/30",
  },
  idle: {
    label: "Idle",
    color: "text-yellow-600",
    bgColor: "bg-yellow-100 dark:bg-yellow-900/30",
  },
  stopping: {
    label: "Stopping",
    color: "text-orange-600",
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
  },
  stopped: {
    label: "Stopped",
    color: "text-gray-600",
    bgColor: "bg-gray-100 dark:bg-gray-800",
  },
  error: {
    label: "Error",
    color: "text-red-600",
    bgColor: "bg-red-100 dark:bg-red-900/30",
  },
};

const prStatusConfig: Record<string, { color: string; bgColor: string }> = {
  draft: { color: "text-gray-600", bgColor: "bg-gray-100 dark:bg-gray-800" },
  open: {
    color: "text-green-600",
    bgColor: "bg-green-100 dark:bg-green-900/30",
  },
  merged: {
    color: "text-purple-600",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
  },
  closed: { color: "text-red-600", bgColor: "bg-red-100 dark:bg-red-900/30" },
};

const workflowStatusConfig: Record<
  WorkflowStatus,
  { label: string; icon: string; color: string; bgColor: string }
> = {
  started: {
    label: "Started",
    icon: "play",
    color: "text-blue-600",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  working: {
    label: "Working",
    icon: "cog",
    color: "text-cyan-600",
    bgColor: "bg-cyan-100 dark:bg-cyan-900/30",
  },
  awaiting_input: {
    label: "Awaiting Input",
    icon: "question",
    color: "text-amber-600",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
  },
  blocked: {
    label: "Blocked",
    icon: "block",
    color: "text-red-600",
    bgColor: "bg-red-100 dark:bg-red-900/30",
  },
  awaiting_review: {
    label: "Awaiting Review",
    icon: "eye",
    color: "text-purple-600",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
  },
  completed: {
    label: "Completed",
    icon: "check",
    color: "text-green-600",
    bgColor: "bg-green-100 dark:bg-green-900/30",
  },
};

function StatusBadge({ status }: { status: SessionStatus }) {
  const config = statusConfig[status];
  const isAnimated =
    status === "provisioning" || status === "starting" || status === "stopping";

  return (
    <span
      data-testid="session-status-badge"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        config.bgColor,
        config.color,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "running"
            ? "bg-green-500"
            : status === "idle"
              ? "bg-yellow-500"
              : status === "error"
                ? "bg-red-500"
                : status === "stopped"
                  ? "bg-gray-400"
                  : "bg-blue-500",
          isAnimated && "animate-pulse",
        )}
      />
      {config.label}
    </span>
  );
}

function PrBadge({ pr }: { pr: LinkedPullRequest }) {
  const config = prStatusConfig[pr.status] ?? prStatusConfig.open!;

  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80",
        config.bgColor,
        config.color,
      )}
      title={pr.title}
    >
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
      </svg>
      #{pr.number}
    </a>
  );
}

function WorkflowStatusBadge({ state }: { state: WorkflowState }) {
  const config = workflowStatusConfig[state.workflowStatus];
  const isAnimated =
    state.workflowStatus === "working" ||
    state.workflowStatus === "awaiting_input";

  return (
    <span
      data-testid="workflow-status-badge"
      data-workflow-status={state.workflowStatus}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        config.bgColor,
        config.color,
      )}
      title={state.statusMessage ?? undefined}
    >
      {state.workflowStatus === "working" && (
        <svg
          className={cn("h-3 w-3", isAnimated && "animate-spin")}
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
          className={cn("h-3 w-3", isAnimated && "animate-pulse")}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-14a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
        </svg>
      )}
      {state.workflowStatus === "blocked" && (
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z" />
        </svg>
      )}
      {state.workflowStatus === "awaiting_review" && (
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
        </svg>
      )}
      {state.workflowStatus === "completed" && (
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
      )}
      {config.label}
    </span>
  );
}

function TaskBadge({ task }: { task: LinkedTask }) {
  const content = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
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
        className="transition-opacity hover:opacity-80"
        title={task.title ?? task.identifier}
      >
        {content}
      </a>
    );
  }

  return content;
}

function VoiceStatusBadge({ status }: { status: "disconnected" | "connecting" | "connected" | "error" }) {
  const config = {
    disconnected: { label: "Voice Off", color: "text-gray-600", bgColor: "bg-gray-100 dark:bg-gray-800" },
    connecting: { label: "Connecting...", color: "text-blue-600", bgColor: "bg-blue-100 dark:bg-blue-900/30" },
    connected: { label: "Voice On", color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900/30" },
    error: { label: "Voice Error", color: "text-red-600", bgColor: "bg-red-100 dark:bg-red-900/30" },
  };

  const { label, color, bgColor } = config[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium",
        color,
        bgColor
      )}
      title={`Voice status: ${label}`}
    >
      <span className={cn(
        "h-1.5 w-1.5 rounded-full",
        status === "connected" ? "bg-green-500 animate-pulse" : status === "connecting" ? "bg-blue-500 animate-pulse" : "bg-gray-400"
      )} />
      {label}
    </span>
  );
}

export function SessionHeader({
  title,
  status,
  agentType,
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
    <div
      data-testid="session-header"
      className="flex items-center justify-between border-b px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <h1
            data-testid="session-title"
            className="truncate text-lg font-semibold"
          >
            {title}
          </h1>
          <StatusBadge status={status} />
          {voiceStatus && agentType === "elevenlabs" && <VoiceStatusBadge status={voiceStatus} />}
          {workflowState && <WorkflowStatusBadge state={workflowState} />}
          {linkedPr && <PrBadge pr={linkedPr} />}
          {linkedTask && <TaskBadge task={linkedTask} />}
        </div>
        <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-gray-800">
            {agentType}
          </span>
          {gitBranch && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M9.5 3.25a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zm-6 0a.75.75 0 100 1.5.75.75 0 000-1.5zm8.25.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
                </svg>
                <code className="font-mono text-xs">{gitBranch}</code>
              </span>
            </>
          )}
          {workingDirectory && (
            <>
              <span>·</span>
              <span className="truncate" title={workingDirectory}>
                {workingDirectory}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="ml-4 flex items-center gap-2">
        {onRename && (
          <Button variant="ghost" size="sm" onClick={onRename}>
            Rename
          </Button>
        )}

        {canStop && onStop && (
          <Button variant="destructive" size="sm" onClick={onStop}>
            Stop
          </Button>
        )}

        {canRestart && onRestart && (
          <Button variant="outline" size="sm" onClick={onRestart}>
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
    if (status === "disconnected" && reconnectIn) {
      return `Reconnecting in ${reconnectIn}s (attempt ${(reconnectAttempt ?? 0) + 1})`;
    }
    return "Disconnected";
  };

  const config: Record<string, { bg: string; text: string }> = {
    disconnected: { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-600" },
    connecting: { bg: "bg-blue-50 dark:bg-blue-900/20", text: "text-blue-600" },
    authenticating: {
      bg: "bg-blue-50 dark:bg-blue-900/20",
      text: "text-blue-600",
    },
    error: { bg: "bg-red-50 dark:bg-red-900/20", text: "text-red-600" },
  };

  const c = config[status] ?? config.disconnected!;

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 py-2 text-sm",
        c.bg,
        c.text,
      )}
    >
      {(status === "connecting" || status === "authenticating") && (
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
      )}
      <span>{getLabel()}</span>
      {status === "error" && onReconnect && (
        <Button variant="ghost" size="sm" onClick={onReconnect}>
          Retry
        </Button>
      )}
    </div>
  );
}
