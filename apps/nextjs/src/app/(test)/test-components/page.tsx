"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type WorkflowStatus =
  | "started"
  | "working"
  | "awaiting_input"
  | "blocked"
  | "awaiting_review"
  | "completed";

type SessionStatus =
  | "provisioning"
  | "starting"
  | "running"
  | "idle"
  | "stopping"
  | "stopped"
  | "error";

interface WorkflowState {
  workflowStatus: WorkflowStatus;
  statusMessage?: string | null;
  awaitingInput?: {
    question: string;
    options?: string[] | null;
    defaultAction: string;
    expiresAt: string;
  } | null;
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

const workflowStatusConfig: Record<
  WorkflowStatus,
  { label: string; color: string; bgColor: string }
> = {
  started: {
    label: "Started",
    color: "text-blue-600",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  working: {
    label: "Working",
    color: "text-cyan-600",
    bgColor: "bg-cyan-100 dark:bg-cyan-900/30",
  },
  awaiting_input: {
    label: "Awaiting Input",
    color: "text-amber-600",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
  },
  blocked: {
    label: "Blocked",
    color: "text-red-600",
    bgColor: "bg-red-100 dark:bg-red-900/30",
  },
  awaiting_review: {
    label: "Awaiting Review",
    color: "text-purple-600",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
  },
  completed: {
    label: "Completed",
    color: "text-green-600",
    bgColor: "bg-green-100 dark:bg-green-900/30",
  },
};

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

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
          status === "running" && "bg-green-500",
          status === "idle" && "bg-yellow-500",
          status === "error" && "bg-red-500",
          status === "stopped" && "bg-gray-400",
          !["running", "idle", "error", "stopped"].includes(status) &&
            "bg-blue-500",
          isAnimated && "animate-pulse",
        )}
      />
      {config.label}
    </span>
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

function SessionHeader({
  title,
  status,
  agentType,
  workingDirectory,
  gitBranch,
  workflowState,
  linkedPr,
  linkedTask,
}: {
  title: string;
  status: SessionStatus;
  agentType: string;
  workingDirectory?: string;
  gitBranch?: string;
  workflowState?: WorkflowState;
  linkedPr?: {
    id: string;
    number: number;
    title: string;
    status: string;
    url: string;
  };
  linkedTask?: {
    id: string;
    identifier: string;
    title?: string;
    url?: string;
  };
}) {
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
          {workflowState && <WorkflowStatusBadge state={workflowState} />}
          {linkedPr && (
            <a
              href={linkedPr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-600 dark:bg-green-900/30"
            >
              #{linkedPr.number}
            </a>
          )}
          {linkedTask && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
              {linkedTask.identifier}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-gray-800">
            {agentType}
          </span>
          {gitBranch && (
            <>
              <span>·</span>
              <code className="font-mono text-xs">{gitBranch}</code>
            </>
          )}
          {workingDirectory && (
            <>
              <span>·</span>
              <span className="truncate">{workingDirectory}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AwaitingInputCard({
  question,
  options,
  defaultAction,
  expiresAt,
  onResolve,
  isResolving,
}: {
  question: string;
  options?: string[] | null;
  defaultAction: string;
  expiresAt: string;
  onResolve?: (response: string) => void;
  isResolving?: boolean;
}) {
  const [customResponse, setCustomResponse] = useState("");
  const [timeRemaining, setTimeRemaining] = useState<string>("");

  const expiresDate = new Date(expiresAt);
  const isExpired = expiresDate < new Date();

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const diff = expiresDate.getTime() - now.getTime();
      if (diff <= 0) {
        setTimeRemaining("Expired");
        return;
      }
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeRemaining(`${minutes}m ${seconds}s`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const handleOptionClick = (option: string) => {
    if (onResolve && !isResolving) {
      onResolve(option);
    }
  };

  const handleCustomSubmit = () => {
    if (onResolve && !isResolving && customResponse.trim()) {
      onResolve(customResponse.trim());
    }
  };

  return (
    <div
      data-testid="awaiting-input-card"
      data-expired={isExpired}
      className={cn(
        "mx-4 my-3 rounded-lg border-2 p-4",
        isExpired
          ? "border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
          : "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <svg
            className={cn(
              "h-5 w-5",
              isExpired ? "text-gray-500" : "animate-pulse text-amber-500",
            )}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-14a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
          </svg>
          <span
            className={cn(
              "text-sm font-medium",
              isExpired
                ? "text-gray-600"
                : "text-amber-700 dark:text-amber-300",
            )}
          >
            {isExpired ? "Input Expired" : "Agent Needs Input"}
          </span>
        </div>
        {!isExpired && (
          <span
            data-testid="time-remaining"
            className="rounded bg-amber-200 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800 dark:bg-amber-800 dark:text-amber-200"
          >
            {timeRemaining} remaining
          </span>
        )}
      </div>

      <p
        data-testid="input-question"
        className={cn(
          "mb-4 text-sm",
          isExpired
            ? "text-gray-600 dark:text-gray-400"
            : "text-gray-800 dark:text-gray-200",
        )}
      >
        {question}
      </p>

      {options && options.length > 0 && !isExpired && (
        <div data-testid="input-options" className="mb-4 flex flex-wrap gap-2">
          {options.map((option, idx) => (
            <button
              key={idx}
              data-testid={`input-option-${idx}`}
              disabled={isResolving}
              onClick={() => handleOptionClick(option)}
              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-600 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-900"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {!isExpired && (
        <div
          data-testid="custom-response-section"
          className="flex items-center gap-2"
        >
          <input
            type="text"
            data-testid="custom-response-input"
            value={customResponse}
            onChange={(e) => setCustomResponse(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCustomSubmit()}
            placeholder="Or type a custom response..."
            disabled={isResolving}
            className="flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm placeholder:text-gray-400 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:placeholder:text-gray-500"
          />
          <button
            data-testid="custom-response-submit"
            disabled={isResolving || !customResponse.trim()}
            onClick={handleCustomSubmit}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isResolving ? "Sending..." : "Send"}
          </button>
        </div>
      )}

      <div
        data-testid="default-action-info"
        className={cn(
          "mt-3 text-xs",
          isExpired ? "text-gray-500" : "text-amber-600 dark:text-amber-400",
        )}
      >
        {isExpired ? (
          <span>Timed out - proceeded with: &quot;{defaultAction}&quot;</span>
        ) : (
          <span>
            Default action if no response: &quot;{defaultAction}&quot;
          </span>
        )}
      </div>
    </div>
  );
}

function ResolvedInputCard({
  question,
  resolution,
}: {
  question: string;
  resolution: { type: "human" | "timeout"; value: string };
}) {
  return (
    <div
      data-testid="resolved-input-card"
      data-resolution-type={resolution.type}
      className="mx-4 my-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="mb-2 flex items-center gap-2">
        <svg
          className={cn(
            "h-4 w-4",
            resolution.type === "human" ? "text-green-500" : "text-gray-400",
          )}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
        </svg>
        <span
          data-testid="resolution-type-label"
          className="text-sm font-medium text-gray-600 dark:text-gray-400"
        >
          {resolution.type === "human"
            ? "Human Response"
            : "Auto-resolved (timeout)"}
        </span>
      </div>
      <p
        data-testid="resolved-question"
        className="mb-2 text-xs text-gray-500 dark:text-gray-500"
      >
        Q: {question}
      </p>
      <p
        data-testid="resolved-answer"
        className="text-sm text-gray-800 dark:text-gray-200"
      >
        A: {resolution.value}
      </p>
    </div>
  );
}

type TestComponent = "session-header" | "awaiting-input" | "resolved-input";

function TestPage() {
  const searchParams = useSearchParams();
  const component = searchParams.get("component") as TestComponent | null;
  const variant = searchParams.get("variant") ?? "default";

  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__testState = {
      resolved,
      resolving,
    };
  }, [resolved, resolving]);

  const handleResolve = (response: string) => {
    setResolving(true);
    setTimeout(() => {
      setResolved(response);
      setResolving(false);
    }, 100);
  };

  if (component === "session-header") {
    const workflowStatusMap: Record<string, WorkflowState> = {
      started: {
        workflowStatus: "started",
        statusMessage: "Session initialized",
      },
      working: { workflowStatus: "working", statusMessage: "Processing task" },
      awaiting_input: {
        workflowStatus: "awaiting_input",
        statusMessage: "Waiting for input",
        awaitingInput: {
          question: "Test question?",
          options: ["A", "B"],
          defaultAction: "A",
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      },
      blocked: {
        workflowStatus: "blocked",
        statusMessage: "Resource unavailable",
      },
      awaiting_review: {
        workflowStatus: "awaiting_review",
        statusMessage: "Ready for review",
      },
      completed: { workflowStatus: "completed", statusMessage: "Done" },
    };

    const sessionStatusMap: Record<string, SessionStatus> = {
      running: "running",
      idle: "idle",
      stopped: "stopped",
      starting: "starting",
      stopping: "stopping",
      error: "error",
      provisioning: "provisioning",
    };

    const workflowState = workflowStatusMap[variant];
    const sessionStatus =
      sessionStatusMap[searchParams.get("sessionStatus") ?? "running"] ??
      "running";

    return (
      <div data-testid="test-container">
        <SessionHeader
          title="Test Session"
          status={sessionStatus}
          agentType="opencode"
          workingDirectory="/test/path"
          gitBranch="feature/test"
          workflowState={workflowState}
          linkedPr={
            searchParams.get("withPr")
              ? {
                  id: "pr-1",
                  number: 42,
                  title: "Test PR",
                  status: "open",
                  url: "https://github.com/org/repo/pull/42",
                }
              : undefined
          }
          linkedTask={
            searchParams.get("withTask")
              ? {
                  id: "task-1",
                  identifier: "PROJ-123",
                  title: "Test Task",
                  url: "https://linear.app/team/PROJ-123",
                }
              : undefined
          }
        />
      </div>
    );
  }

  if (component === "awaiting-input") {
    const now = Date.now();
    const variants: Record<
      string,
      { options: string[] | null; expiresAt: string }
    > = {
      default: {
        options: ["Option A", "Option B", "Option C"],
        expiresAt: new Date(now + 300000).toISOString(),
      },
      "no-options": {
        options: null,
        expiresAt: new Date(now + 300000).toISOString(),
      },
      "expiring-soon": {
        options: ["Yes", "No"],
        expiresAt: new Date(now + 30000).toISOString(),
      },
      expired: {
        options: ["A", "B"],
        expiresAt: new Date(now - 60000).toISOString(),
      },
    };

    const config = variants[variant] ?? variants.default!;

    return (
      <div data-testid="test-container">
        <AwaitingInputCard
          question="Which option should I choose?"
          options={config.options}
          defaultAction="Option A"
          expiresAt={config.expiresAt}
          onResolve={handleResolve}
          isResolving={resolving}
        />
        {resolved && <div data-testid="resolution-result">{resolved}</div>}
      </div>
    );
  }

  if (component === "resolved-input") {
    const isTimeout = variant === "timeout";

    return (
      <div data-testid="test-container">
        <ResolvedInputCard
          question="Which option did you choose?"
          resolution={{
            type: isTimeout ? "timeout" : "human",
            value: isTimeout
              ? "Default action taken"
              : "User selected Option B",
          }}
        />
      </div>
    );
  }

  return (
    <div data-testid="test-container" className="p-4">
      <p>
        Use query params:
        ?component=session-header|awaiting-input|resolved-input&variant=...
      </p>
    </div>
  );
}

export default function ComponentTestPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TestPage />
    </Suspense>
  );
}
