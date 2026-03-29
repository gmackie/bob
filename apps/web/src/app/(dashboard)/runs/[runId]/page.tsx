"use client";

import { use } from "react";
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

const ARTIFACT_LABELS: Record<string, string> = {
  diff: "Diff",
  log: "Agent Log",
  "test-report": "Test Report",
  "file-snapshot": "File Snapshot",
};

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const trpc = useTRPC();

  const { data: run, isLoading } = useQuery(
    trpc.publicApi.getRun.queryOptions(
      { runId },
      { refetchInterval: (query) => query.state.data?.status === "running" ? 3000 : false },
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
  const duration = run.summary?.duration_ms;
  const filesChanged = run.summary?.files_changed ?? 0;
  const exitCode = run.summary?.exit_code;

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
                run.status === "completed" && "text-green-600 dark:text-green-400",
                run.status === "failed" && "text-red-600 dark:text-red-400",
                run.status === "running" && "text-amber-600 dark:text-amber-400",
              )}
            />
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {run.workItemId}
            </h1>
            <Badge
              className={cn(
                "text-xs font-medium",
                STATUS_COLORS[run.status],
              )}
            >
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
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" /> All runs
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            Status
          </p>
          <p className="mt-1 text-lg font-semibold capitalize">{run.status}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            Duration
          </p>
          <p className="mt-1 text-lg font-semibold">
            {duration ? formatDuration(duration) : "—"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            Files Changed
          </p>
          <p className="mt-1 text-lg font-semibold">{filesChanged}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            Exit Code
          </p>
          <p
            className={cn(
              "mt-1 text-lg font-semibold",
              exitCode !== 0 && exitCode !== undefined && "text-red-600",
            )}
          >
            {exitCode ?? "—"}
          </p>
        </Card>
      </div>

      {/* Artifacts */}
      <div>
        <h2 className="font-display mb-3 text-lg font-semibold">Artifacts</h2>
        {!run.artifacts?.length ? (
          <Card className="p-6 text-center">
            <p className="text-muted-foreground text-sm">
              No artifacts collected for this run.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {run.artifacts.map((artifact: any) => (
              <Card key={artifact.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">
                      {ARTIFACT_LABELS[artifact.type] ?? artifact.type}
                    </span>
                    <span className="text-muted-foreground ml-2 font-mono text-xs">
                      {artifact.storageKey.split("/").pop()}
                    </span>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {new Date(artifact.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                {/* Metadata display */}
                {artifact.metadata && Object.keys(artifact.metadata).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-3">
                    {Object.entries(artifact.metadata).map(([key, value]) => (
                      <span
                        key={key}
                        className="text-muted-foreground text-xs"
                      >
                        <span className="font-medium">
                          {key.replace(/_/g, " ")}:
                        </span>{" "}
                        {String(value)}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Run metadata */}
      <Card className="p-4">
        <h3 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">
          Run Details
        </h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Run ID:</span>{" "}
            <span className="font-mono text-xs">{run.id}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Agent:</span>{" "}
            {run.agentType}
          </div>
          <div>
            <span className="text-muted-foreground">Started:</span>{" "}
            {run.startedAt
              ? new Date(run.startedAt).toLocaleString()
              : "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Completed:</span>{" "}
            {run.completedAt
              ? new Date(run.completedAt).toLocaleString()
              : "—"}
          </div>
        </div>
      </Card>
    </div>
  );
}
