"use client";

import { AlertCircle, Bot, ExternalLink, PauseCircle, PlayCircle, Square } from "lucide-react";

import { Button } from "@linear-clone/ui/components/button";

import type { BobRunSummary, IssueArtifactSummary } from "./task-detail-types";

function formatWorkflowStatus(workflowStatus?: string | null) {
  if (!workflowStatus) return "Idle";
  return workflowStatus.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function getPrimaryActionLabel(activeRun: BobRunSummary | null, hasHistory: boolean) {
  if (activeRun) {
    return activeRun.status === "failed_to_start" ? "Retry" : "Stop";
  }

  return hasHistory ? "Restart with Bob" : "Start with Bob";
}

function ArtifactStrip({ artifacts }: { artifacts: IssueArtifactSummary[] }) {
  if (artifacts.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {artifacts.map((artifact) => (
        <span
          key={artifact.id}
          className="rounded-full border border-border/70 bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground"
        >
          {artifact.artifactType === "pr"
            ? "PR"
            : artifact.artifactType === "verification"
              ? "Verification"
              : artifact.artifactType === "build"
                ? "Build"
                : artifact.artifactType === "test_report"
                  ? "Test report"
                  : artifact.artifactType === "doc"
                    ? "Doc"
                    : artifact.artifactType === "deliverable"
                      ? "Deliverable"
                      : "Artifact"}
        </span>
      ))}
    </div>
  );
}

export function BobPanel({
  activeRun,
  hasHistory,
  artifacts,
  onPrimaryAction,
}: {
  activeRun: BobRunSummary | null;
  hasHistory: boolean;
  artifacts: IssueArtifactSummary[];
  onPrimaryAction?: () => void;
}) {
  const primaryActionLabel = getPrimaryActionLabel(activeRun, hasHistory);
  const workflowStatus = formatWorkflowStatus(activeRun?.session?.workflowStatus);

  return (
    <section className="rounded-2xl border border-border/70 bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-primary/10 p-2 text-primary">
              <Bot className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Bob</h3>
              <p className="text-xs text-muted-foreground">Execution console for this issue</p>
            </div>
          </div>
        </div>
        <span className="rounded-full bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {workflowStatus}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {activeRun?.latestSummary ? (
          <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
            {activeRun.session?.workflowStatus === "awaiting_input" ? (
              <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700">
                <AlertCircle className="h-3.5 w-3.5" />
                Awaiting input
              </div>
            ) : null}
            <p className="text-sm">{activeRun.latestSummary}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/70 bg-background px-3 py-3 text-sm text-muted-foreground">
            No active Bob summary yet.
          </div>
        )}

        <ArtifactStrip artifacts={artifacts} />

        <div className="flex flex-wrap gap-2">
          {activeRun?.externalSessionUrl ? (
            <Button size="sm" variant="outline" asChild>
              <a href={activeRun.externalSessionUrl} target="_blank" rel="noreferrer">
                Open Bob
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}
          <Button size="sm" onClick={onPrimaryAction}>
            {activeRun ? (
              primaryActionLabel === "Stop" ? (
                <Square className="h-3.5 w-3.5" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )
            ) : hasHistory ? (
              <PauseCircle className="h-3.5 w-3.5" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            {primaryActionLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}
