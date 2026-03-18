"use client";

import type { WorkflowStage } from "~/lib/workflow/stage";

const TRANSITION_CONFIG: Record<
  WorkflowStage,
  { action: string; description: string } | null
> = {
  idea: {
    action: "Shape this idea with Bob →",
    description:
      "Open a planning session to define requirements and scope this idea.",
  },
  shape: {
    action: "Break into tasks →",
    description:
      "Generate child tasks from the requirements so agents can start working.",
  },
  plan: {
    action: "Dispatch agents →",
    description:
      "Assign tasks to agents who will create branches, write code, and open PRs.",
  },
  execute: null,
  review: {
    action: "Merge & deploy →",
    description:
      "Merge the feature PR into the target branch and trigger deployment.",
  },
  deploy: null,
  live: null,
};

interface StageTransitionProps {
  currentStage: WorkflowStage;
  onTransition: (action: string) => void;
}

export function StageTransition({
  currentStage,
  onTransition,
}: StageTransitionProps) {
  const config = TRANSITION_CONFIG[currentStage];

  if (!config) return null;

  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center">
      <button
        type="button"
        onClick={() => onTransition(config.action)}
        className="bg-primary text-primary-foreground rounded-xl px-6 py-3 text-sm font-medium transition-colors hover:bg-primary/90"
      >
        {config.action}
      </button>
      <p className="text-muted-foreground mt-3 text-sm">{config.description}</p>
    </div>
  );
}
