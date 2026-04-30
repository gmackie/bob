"use client";

import { useState } from "react";

import { cn } from "@gmacko/core/ui";

interface StageLiveProps {
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
  deployedAt?: string;
}

export function StageLive({
  workItemId,
  workItem,
  isCurrentStage,
  isCompleted,
  deployedAt,
}: StageLiveProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isCollapsed = isCompleted && collapsed;

  return (
    <section
      id="stage-live"
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
          Live
        </h2>

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
          {/* Success banner */}
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-6 py-5 text-center">
            <div className="flex items-center justify-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3 7L6 10L11 4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <h3 className="font-display text-lg font-bold text-emerald-600 dark:text-emerald-400">
                This feature is live!
              </h3>
            </div>

            <p className="mt-2 text-sm text-emerald-700/80 dark:text-emerald-400/70">
              {workItem.title} has been deployed and is running in production.
            </p>
          </div>

          {/* Deployment details */}
          <div className="rounded-2xl border border-border p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {/* Deployed timestamp */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Deployed
                </div>
                <div className="mt-1 text-sm text-foreground">
                  {deployedAt
                    ? new Date(deployedAt).toLocaleString()
                    : "Unknown"}
                </div>
              </div>

              {/* Work item identifier */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Work Item
                </div>
                <div className="mt-1 font-mono text-sm text-foreground">
                  {workItem.identifier}
                </div>
              </div>

              {/* Environment */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Environment
                </div>
                <div className="mt-1 text-sm text-foreground">Production</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
