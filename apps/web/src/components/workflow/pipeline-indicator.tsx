"use client";

import { cn } from "@bob/ui";

import { STAGES, type WorkflowStage } from "~/lib/workflow/stage";

interface PipelineIndicatorProps {
  currentStage: WorkflowStage;
  onStageClick?: (stage: WorkflowStage) => void;
  /** Set of stages that have at least one snapshot available. */
  snapshotStages?: Set<WorkflowStage>;
  /** Called when a completed stage dot with snapshots is clicked. */
  onViewSnapshot?: (stage: WorkflowStage) => void;
}

export function PipelineIndicator({
  currentStage,
  onStageClick,
  snapshotStages,
  onViewSnapshot,
}: PipelineIndicatorProps) {
  const currentIndex = STAGES.findIndex((s) => s.key === currentStage);

  return (
    <div className="flex w-full items-center justify-between gap-0">
      {STAGES.map((stage, idx) => {
        const isCompleted = idx < currentIndex;
        const isCurrent = idx === currentIndex;
        const isFuture = idx > currentIndex;
        const hasSnapshot = snapshotStages?.has(stage.key) ?? false;

        return (
          <div key={stage.key} className="flex flex-1 items-center">
            {/* Stage dot + label */}
            <button
              type="button"
              onClick={() => {
                if (isCompleted && hasSnapshot && onViewSnapshot) {
                  onViewSnapshot(stage.key);
                } else {
                  onStageClick?.(stage.key);
                }
              }}
              className={cn(
                "relative flex flex-col items-center gap-1.5",
                (onStageClick || (isCompleted && hasSnapshot && onViewSnapshot)) &&
                  "cursor-pointer",
                !onStageClick &&
                  !(isCompleted && hasSnapshot && onViewSnapshot) &&
                  "cursor-default",
              )}
            >
              {/* Dot */}
              <div
                className={cn(
                  "h-3 w-3 rounded-full transition-colors",
                  isCompleted && "bg-emerald-500",
                  isCurrent && "bg-primary animate-pulse",
                  isFuture && "bg-muted-foreground/30",
                )}
              />

              {/* Snapshot clock icon on completed dots */}
              {isCompleted && hasSnapshot && (
                <svg
                  className="absolute -right-1.5 -top-1.5 h-3 w-3 text-muted-foreground"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm0 14A6 6 0 1 1 8 2a6 6 0 0 1 0 12zm.5-9H7v5l4.28 2.54.72-1.21-3.5-2.08V5z" />
                </svg>
              )}

              {/* Label -- hidden on mobile, shown on sm+ */}
              <span
                className={cn(
                  "hidden text-xs font-medium sm:block",
                  isCompleted && "text-emerald-600 dark:text-emerald-400",
                  isCurrent && "text-primary",
                  isFuture && "text-muted-foreground",
                )}
              >
                {stage.label}
              </span>
            </button>

            {/* Connecting line (not after the last stage) */}
            {idx < STAGES.length - 1 && (
              <div
                className={cn(
                  "mx-1 h-0.5 flex-1",
                  idx < currentIndex
                    ? "bg-emerald-500"
                    : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
