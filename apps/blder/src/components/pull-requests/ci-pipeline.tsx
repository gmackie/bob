"use client";

import { cn } from "@bob/ui";

export interface CiBuild {
  id: string;
  status: string;
  ciProvider: string | null;
  externalJobId: string | null;
  durationMs: number | null;
  createdAt: Date;
}

interface CiPipelineProps {
  builds: CiBuild[];
}

function statusIcon(status: string): { icon: string; color: string } {
  switch (status) {
    case "success":
    case "passed":
      return { icon: "\u2713", color: "text-emerald-600 dark:text-emerald-400" };
    case "failed":
    case "error":
      return { icon: "\u2717", color: "text-red-600 dark:text-red-400" };
    case "running":
    case "in_progress":
      return { icon: "\u25CB", color: "text-amber-600 dark:text-amber-400" };
    case "queued":
    case "pending":
      return { icon: "\u25CB", color: "text-muted-foreground" };
    default:
      return { icon: "\u25CB", color: "text-muted-foreground" };
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export function CiPipeline({ builds }: CiPipelineProps) {
  if (builds.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <h2 className="font-display text-sm font-semibold text-foreground">
          CI Pipeline
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">
          No builds linked to this pull request yet.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <h2 className="font-display text-sm font-semibold text-foreground">
        CI Pipeline
      </h2>
      <ul className="mt-3 space-y-2">
        {builds.map((build) => {
          const { icon, color } = statusIcon(build.status);
          return (
            <li key={build.id} className="flex items-center gap-3 text-sm">
              <span className={cn("text-base font-bold", color)}>{icon}</span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {build.ciProvider ?? "Build"}{" "}
                {build.externalJobId && (
                  <span className="font-mono text-xs text-muted-foreground">
                    #{build.externalJobId}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {build.status}
              </span>
              {build.durationMs !== null && (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatDuration(build.durationMs)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
