"use client";

import { Badge } from "@gmacko/core/ui/badge";

import type { WorkflowStage } from "~/lib/workflow/stage";

const TRANSITION_CONFIG: Record<
  WorkflowStage,
  {
    action: string;
    description: string;
    skills?: string[];
    contextHint?: string;
  } | null
> = {
  idea: {
    action: "Shape this idea with Bob →",
    description:
      "Open a guided shaping session, add notes or docs, and let Bob clarify the parent scope before execution starts.",
    skills: ["work-item-shaping"],
    contextHint: "Add docs, screenshots, or repo files before launch",
  },
  shape: {
    action: "Break into tasks →",
    description:
      "Prepare a task-planning session with requirements, BRD context, and ownership hints before Bob drafts child tasks.",
    skills: ["work-item-breakdown"],
    contextHint: "Bring requirements, BRDs, and repo context into the session",
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
    <div className="rounded-[1.5rem] border border-primary/20 bg-[linear-gradient(135deg,rgba(59,130,246,0.08),rgba(15,23,42,0.9))] p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <div className="flex flex-wrap gap-2">
            {(config.skills ?? []).map((skill) => (
              <Badge
                key={skill}
                className="border-primary/20 bg-primary/10 text-primary"
              >
                {skill}
              </Badge>
            ))}
            {config.contextHint ? (
              <Badge className="border-white/10 bg-white/5 text-slate-200">
                {config.contextHint}
              </Badge>
            ) : null}
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {config.description}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onTransition(config.action)}
          className="rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {config.action}
        </button>
      </div>
    </div>
  );
}
