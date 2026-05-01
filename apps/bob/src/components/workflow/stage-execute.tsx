"use client";

import { useState } from "react";
import Link from "next/link";

import { cn } from "@gmacko/core/ui";

interface DispatchStatus {
  total: number;
  completed: number;
  failed: number;
  running: number;
}

interface DispatchTask {
  id: string;
  identifier: string;
  title: string;
  status: string;
  branch?: string;
  duration?: string;
}

interface StageExecuteProps {
  workItemId: string;
  workItem: {
    id: string;
    title: string;
    description: string | null;
    kind: string;
    status: string;
    identifier: string;
  };
  isCurrentStage: boolean;
  isCompleted: boolean;
  dispatchStatus: DispatchStatus;
  tasks: DispatchTask[];
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-blue-500 animate-pulse",
  complete: "bg-emerald-500",
  done: "bg-emerald-500",
  failed: "bg-rose-500",
  queued: "bg-muted-foreground/40",
  pending: "bg-muted-foreground/40",
};

export function StageExecute({
  workItemId,
  workItem,
  isCurrentStage,
  isCompleted,
  dispatchStatus,
  tasks,
}: StageExecuteProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isCollapsed = isCompleted && collapsed;

  const pct =
    dispatchStatus.total > 0
      ? Math.round((dispatchStatus.completed / dispatchStatus.total) * 100)
      : 0;

  return (
    <section
      id="stage-execute"
      className="rounded-3xl border border-border bg-card p-6"
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => isCompleted && setCollapsed((c) => !c)}
        className={cn(
          "flex w-full items-center gap-3",
          isCompleted && "cursor-pointer",
        )}
      >
        <h2 className="font-display text-lg font-semibold text-foreground">
          Execute
        </h2>

        <span className="text-sm text-muted-foreground">
          {dispatchStatus.completed}/{dispatchStatus.total} complete
          {dispatchStatus.failed > 0 && (
            <span className="ml-1 text-rose-500">
              ({dispatchStatus.failed} failed)
            </span>
          )}
        </span>

        {isCompleted && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2.5 6L5 8.5L9.5 3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}

        {isCompleted && (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className={cn(
              "ml-auto text-muted-foreground transition-transform",
              isCollapsed && "-rotate-90",
            )}
            aria-hidden="true"
          >
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="mt-4 space-y-4">
          {/* Progress bar */}
          <div className="space-y-1">
            <div className="h-2 rounded-full bg-secondary">
              <div
                className="h-2 rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{pct}% complete</span>
              {dispatchStatus.running > 0 && (
                <span>{dispatchStatus.running} running</span>
              )}
            </div>
          </div>

          {/* Task list */}
          {tasks.length > 0 && (
            <div className="divide-y divide-border rounded-2xl border border-border">
              {tasks.map((task) => {
                const isRunning =
                  task.status === "running" ||
                  task.status === "in_progress";

                return (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    {/* Status dot */}
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        STATUS_DOT[task.status] ?? STATUS_DOT.queued,
                      )}
                    />

                    {/* Title */}
                    <span className="flex-1 truncate text-sm text-foreground">
                      {task.title}
                    </span>

                    {/* Branch */}
                    {task.branch && (
                      <span className="hidden truncate rounded-md bg-accent px-2 py-0.5 font-mono text-xs text-muted-foreground sm:block">
                        {task.branch}
                      </span>
                    )}

                    {/* Duration */}
                    {task.duration && (
                      <span className="text-xs text-muted-foreground">
                        {task.duration}
                      </span>
                    )}

                    {/* View workspace link */}
                    {isRunning && (
                      <Link
                        href={`/work-items/${task.id}`}
                        className="shrink-0 text-xs font-medium text-primary hover:underline"
                      >
                        View workspace
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* View Execution Review link */}
          {dispatchStatus.completed > 0 && (
            <a
              href={`/work-items/${workItemId}/review`}
              className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            >
              View Execution Review →
            </a>
          )}
        </div>
      )}
    </section>
  );
}
