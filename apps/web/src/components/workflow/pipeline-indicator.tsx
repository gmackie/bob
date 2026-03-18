"use client";

import { cn } from "@bob/ui";

import { STAGES, type WorkflowStage } from "~/lib/workflow/stage";

interface PipelineIndicatorProps {
  currentStage: WorkflowStage;
  onStageClick?: (stage: WorkflowStage) => void;
}

export function PipelineIndicator({
  currentStage,
  onStageClick,
}: PipelineIndicatorProps) {
  const currentIndex = STAGES.findIndex((s) => s.key === currentStage);

  return (
    <div className="flex w-full items-center justify-between gap-0">
      {STAGES.map((stage, idx) => {
        const isCompleted = idx < currentIndex;
        const isCurrent = idx === currentIndex;
        const isFuture = idx > currentIndex;

        return (
          <div key={stage.key} className="flex flex-1 items-center">
            {/* Stage dot + label */}
            <button
              type="button"
              onClick={() => onStageClick?.(stage.key)}
              className={cn(
                "flex flex-col items-center gap-1.5",
                onStageClick && "cursor-pointer",
                !onStageClick && "cursor-default",
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

              {/* Label — hidden on mobile, shown on sm+ */}
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
