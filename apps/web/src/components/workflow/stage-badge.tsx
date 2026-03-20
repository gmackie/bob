"use client";

import { cn } from "@bob/ui";
import { detectStage, type StageDetectionInput } from "~/lib/workflow/stage";

interface StageBadgeProps {
  stageInput: StageDetectionInput;
  className?: string;
}

export function StageBadge({ stageInput, className }: StageBadgeProps) {
  const { stage } = detectStage(stageInput);

  const colors: Record<string, string> = {
    idea: "bg-muted text-muted-foreground",
    shape: "bg-primary/10 text-primary",
    plan: "bg-primary/10 text-primary",
    execute: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    review: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    deploy: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    live: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  };

  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        colors[stage] ?? colors.idea,
        className,
      )}
      aria-label={`Stage: ${stage}`}
    >
      {stage.charAt(0).toUpperCase() + stage.slice(1)}
    </span>
  );
}
