"use client";

import { Button } from "@linear-clone/ui/components/button";

import type { BobRunSummary } from "./task-detail-types";

function formatRunStatus(status: string) {
  return status.replace(/_/g, " ");
}

function formatRunTime(value?: Date | string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isResumableRun(status: string) {
  return ["claimed", "in_progress", "failed_to_start", "abandoned", "handed_off"].includes(status);
}

export function BobRunHistory({
  runs,
  onContinueRun,
}: {
  runs: BobRunSummary[];
  onContinueRun?: (runId: string) => void;
}) {
  if (runs.length === 0) {
    return null;
  }

  const latestResumableRun = runs.find((run) => isResumableRun(run.status)) ?? null;

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Run history</h3>
      <div className="space-y-2">
        {runs.map((run) => (
          <article
            key={run.id}
            className="rounded-xl border border-border/70 bg-background px-3 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {formatRunStatus(run.status)}
                </p>
                {run.latestSummary ? <p className="mt-1 text-sm">{run.latestSummary}</p> : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatRunTime(run.claimedAt) || "Unknown start"}
                  {run.completedAt ? ` to ${formatRunTime(run.completedAt)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {latestResumableRun?.id === run.id && onContinueRun ? (
                  <Button size="sm" variant="outline" onClick={() => onContinueRun(run.id)}>
                    Continue in Bob
                  </Button>
                ) : null}
                {run.externalSessionUrl ? (
                  <Button size="sm" variant="ghost" asChild>
                    <a href={run.externalSessionUrl} target="_blank" rel="noreferrer">
                      Open Bob
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
