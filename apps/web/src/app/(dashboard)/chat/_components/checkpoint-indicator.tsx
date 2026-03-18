"use client";

import { cn } from "@bob/ui";

interface CheckpointIndicatorProps {
  checkpointId: string;
  turnNumber: number;
  label?: string | null;
  onBranch: (checkpointId: string) => void;
}

export function CheckpointIndicator({
  checkpointId,
  turnNumber,
  label,
  onBranch,
}: CheckpointIndicatorProps) {
  return (
    <div className="relative my-2 flex items-center gap-2 px-4">
      {/* Line left */}
      <div className="h-px flex-1 bg-border" />

      {/* Diamond marker */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block size-2 rotate-45 rounded-[1px]",
            "bg-muted-foreground/50",
          )}
        />
        <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
          Turn {turnNumber}
        </span>
        {label && (
          <span className="text-[10px] text-muted-foreground/70">
            &middot; {label}
          </span>
        )}
        <button
          type="button"
          onClick={() => onBranch(checkpointId)}
          className={cn(
            "ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
            "text-primary hover:bg-primary/10",
            "transition-colors duration-150",
          )}
        >
          Branch from here
        </button>
      </div>

      {/* Line right */}
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
