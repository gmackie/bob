"use client";

import { useState } from "react";
import Link from "next/link";

import { cn } from "@bob/ui";

import { SessionHistory } from "./session-history";

interface ChildTask {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
}

interface StagePlanProps {
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
  childTasks: ChildTask[];
}

const STATUS_STYLES: Record<string, string> = {
  backlog: "bg-muted-foreground/15 text-muted-foreground",
  todo: "bg-muted-foreground/15 text-muted-foreground",
  in_progress: "bg-primary/15 text-primary",
  in_review: "bg-blue-500/15 text-blue-500",
  done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  cancelled: "bg-rose-500/15 text-rose-500",
};

const PRIORITY_INDICATORS: Record<string, string> = {
  urgent: "text-rose-500",
  high: "text-amber-500",
  medium: "text-foreground",
  low: "text-muted-foreground",
  none: "text-muted-foreground",
};

export function StagePlan({
  workItemId,
  workItem,
  isCurrentStage,
  isCompleted,
  childTasks,
}: StagePlanProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isCollapsed = isCompleted && collapsed;

  const totalTasks = childTasks.length;
  const doneTasks = childTasks.filter((t) => t.status === "done").length;

  return (
    <section
      id="stage-plan"
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
          Plan
        </h2>

        <span className="text-sm text-muted-foreground">
          {doneTasks}/{totalTasks} task{totalTasks !== 1 ? "s" : ""}
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
        <div className="mt-4 space-y-2">
          {childTasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No tasks yet. Break this work item into actionable tasks.
            </div>
          ) : (
            <div className="divide-y divide-border rounded-2xl border border-border">
              {childTasks.map((task) => (
                <Link
                  key={task.id}
                  href={`/work-items/${task.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-accent"
                >
                  {/* Priority indicator */}
                  <span
                    className={cn(
                      "text-xs font-bold",
                      PRIORITY_INDICATORS[task.priority] ??
                        PRIORITY_INDICATORS.medium,
                    )}
                    title={task.priority}
                  >
                    {task.priority === "urgent"
                      ? "!!!"
                      : task.priority === "high"
                        ? "!!"
                        : task.priority === "low"
                          ? "-"
                          : "!"}
                  </span>

                  {/* Identifier */}
                  <span className="font-mono text-xs text-muted-foreground">
                    {task.identifier}
                  </span>

                  {/* Title */}
                  <span className="flex-1 truncate text-sm text-foreground">
                    {task.title}
                  </span>

                  {/* Status badge */}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      STATUS_STYLES[task.status] ?? STATUS_STYLES.todo,
                    )}
                  >
                    {task.status.replace("_", " ")}
                  </span>
                </Link>
              ))}
            </div>
          )}

          <SessionHistory
            workItemId={workItemId}
            sessionTypes={["ceo_review", "eng_review", "design_review", "breakdown"]}
            className="mt-4"
          />
        </div>
      )}
    </section>
  );
}
