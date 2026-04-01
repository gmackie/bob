"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeftIcon,
  CheckCircledIcon,
  CrossCircledIcon,
  ClockIcon,
} from "@radix-ui/react-icons";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { Card } from "@bob/ui/card";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { useTRPC } from "~/trpc/react";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  running: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  completed: CheckCircledIcon,
  failed: CrossCircledIcon,
  running: ClockIcon,
  queued: ClockIcon,
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function getSummaryValue(
  summary: Record<string, unknown> | null | undefined,
  key: string,
): unknown {
  return summary?.[key] ?? null;
}

type Tab = "summary" | "chat" | "files" | "diff" | "artifacts";

const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "chat", label: "Chat" },
  { key: "files", label: "Files" },
  { key: "diff", label: "Diff" },
  { key: "artifacts", label: "Artifacts" },
];

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const trpc = useTRPC();
  const [activeTab, setActiveTab] = useState<Tab>("summary");

  const { data: run, isLoading } = useQuery(
    trpc.agentRun.get.queryOptions(
      { runId },
      {
        refetchInterval: (query) =>
          query.state.data?.status === "running" ? 3000 : false,
      },
    ),
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="bg-muted/50 h-8 w-48 animate-pulse rounded" />
        <div className="bg-muted/50 h-40 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Run not found.</p>
      </div>
    );
  }

  const StatusIcon = STATUS_ICONS[run.status] ?? ClockIcon;
  const duration = getSummaryValue(run.summary, "duration_ms") as number | null;
  const filesChanged = (getSummaryValue(run.summary, "files_changed") as number) ?? 0;
  const exitCode = getSummaryValue(run.summary, "exit_code") as number | null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs
        items={[
          { label: "Runs", href: "/runs" },
          { label: run.workItemId },
        ]}
      />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <StatusIcon
              className={cn(
                "size-5",
                run.status === "completed" && "text-green-600",
                run.status === "failed" && "text-red-600",
                run.status === "running" && "text-amber-600",
              )}
            />
            <h1 className="font-display text-2xl font-bold tracking-tight">
              <Link href={`/work-items/${run.workItemId}`} className="hover:text-primary">
                {run.workItemId}
              </Link>
            </h1>
            <Badge className={cn("text-xs font-medium", STATUS_COLORS[run.status])}>
              {run.status}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            via <span className="font-medium">{run.agentType}</span>
            {duration && <> in {formatDuration(duration)}</>}
          </p>
        </div>
        <Link
          href="/runs"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-3.5" /> All runs
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2",
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.key === "artifacts" && run.artifacts?.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({run.artifacts.length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "summary" && (
        <div className="flex flex-col gap-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card className="p-4">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Status</p>
              <p className="mt-1 text-lg font-semibold capitalize">{run.status}</p>
            </Card>
            <Card className="p-4">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Duration</p>
              <p className="mt-1 text-lg font-semibold">{duration ? formatDuration(duration) : "—"}</p>
            </Card>
            <Card className="p-4">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Files Changed</p>
              <p className="mt-1 text-lg font-semibold">{filesChanged}</p>
            </Card>
            <Card className="p-4">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Exit Code</p>
              <p className={cn("mt-1 text-lg font-semibold", exitCode !== 0 && exitCode != null && "text-red-600")}>
                {exitCode ?? "—"}
              </p>
            </Card>
          </div>

          {/* Run metadata */}
          <Card className="p-4">
            <h3 className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wider">Run Details</h3>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <div><span className="text-muted-foreground">Run ID:</span> <span className="font-mono text-xs">{run.id}</span></div>
              <div><span className="text-muted-foreground">Agent:</span> {run.agentType}</div>
              <div><span className="text-muted-foreground">Started:</span> {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}</div>
              <div><span className="text-muted-foreground">Completed:</span> {run.completedAt ? new Date(run.completedAt).toLocaleString() : "—"}</div>
              <div><span className="text-muted-foreground">Work Item:</span> <Link href={`/work-items/${run.workItemId}`} className="text-primary hover:underline">{run.workItemId}</Link></div>
              <div><span className="text-muted-foreground">Workspace:</span> <span className="font-mono text-xs">{run.workspaceId}</span></div>
            </div>
          </Card>
        </div>
      )}

      {activeTab === "chat" && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Agent chat log will appear here when the Bob daemon captures conversation output.
          </p>
          <p className="text-muted-foreground mt-2 text-xs">
            Coming in the next release.
          </p>
        </Card>
      )}

      {activeTab === "files" && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground text-sm">
            File tree of changes made by the agent will appear here.
          </p>
          <p className="text-muted-foreground mt-2 text-xs">
            The Bob daemon collects file change data via git diff.
          </p>
        </Card>
      )}

      {activeTab === "diff" && (
        <div>
          {run.artifacts?.find((a: any) => a.type === "diff") ? (
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-medium">Git Diff</h3>
              <pre className="overflow-x-auto rounded bg-muted p-4 font-mono text-xs leading-relaxed">
                {(() => {
                  const diffArtifact = run.artifacts.find((a: any) => a.type === "diff");
                  const meta = diffArtifact?.metadata;
                  if (!meta) return "No diff data available.";
                  return `${meta.files_changed ?? 0} files changed, ${meta.insertions ?? 0} insertions(+), ${meta.deletions ?? 0} deletions(-)`;
                })()}
              </pre>
            </Card>
          ) : (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground text-sm">No diff artifact for this run.</p>
            </Card>
          )}
        </div>
      )}

      {activeTab === "artifacts" && (
        <div>
          {!run.artifacts?.length ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground text-sm">No artifacts collected for this run.</p>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {run.artifacts.map((artifact: any) => (
                <Card key={artifact.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium capitalize">{artifact.type}</span>
                      <span className="text-muted-foreground ml-2 font-mono text-xs">
                        {artifact.storageKey.split("/").pop()}
                      </span>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {new Date(artifact.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  {artifact.metadata && Object.keys(artifact.metadata).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-3">
                      {Object.entries(artifact.metadata).map(([key, value]) => (
                        <span key={key} className="text-muted-foreground text-xs">
                          <span className="font-medium">{key.replace(/_/g, " ")}:</span> {String(value)}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
