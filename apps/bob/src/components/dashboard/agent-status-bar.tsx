"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@gmacko/core/ui";
import { useTRPC } from "~/trpc/react";

function formatUptime(createdAt: Date | string): string {
  const start = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ${diffMin % 60}m`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ${diffHr % 24}h`;
}

export function AgentStatusBar() {
  const trpc = useTRPC();

  const { data: instances, isLoading: instancesLoading } = useQuery(
    trpc.instance.list.queryOptions(),
  );

  const { data: allRuns, isLoading: runsLoading } = useQuery({
    ...trpc.agentRun.listAll.queryOptions({ limit: 100 }),
    refetchInterval: 10_000,
  });

  const isLoading = instancesLoading && runsLoading;

  if (isLoading) {
    return (
      <div className="h-10 animate-pulse rounded-xl bg-muted/50" />
    );
  }

  const runs = (allRuns ?? []) as any[];
  const runningCount = runs.filter((r) => r.status === "running").length;
  const completedCount = runs.filter((r) => r.status === "completed").length;
  const failedCount = runs.filter((r) => r.status === "failed" || r.status === "interrupted").length;
  const queuedCount = runs.filter((r) => r.status === "queued").length;

  const activeInstances = instances?.filter(
    (i) => i.status === "running" || i.status === "starting",
  ) ?? [];

  const hasFailures = failedCount > 0;
  const hasRunning = runningCount > 0 || activeInstances.length > 0;

  const barColor = hasFailures
    ? "border-rose-500/20 bg-rose-50 dark:bg-rose-950/20"
    : hasRunning
      ? "border-blue-500/20 bg-blue-50 dark:bg-blue-950/20"
      : runs.length > 0
        ? "border-green-500/20 bg-green-50 dark:bg-green-950/20"
        : "border-border bg-card";

  const totalSessions = runs.length;

  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-2xl border px-5 py-2.5",
        barColor,
      )}
    >
      {totalSessions === 0 && activeInstances.length === 0 ? (
        <span className="font-body text-sm text-muted-foreground">
          No sessions tracked
        </span>
      ) : (
        <>
          <div className="flex items-center gap-3 font-body text-sm text-muted-foreground">
            {runningCount > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="font-semibold text-foreground">
                  {runningCount}
                </span>{" "}
                running
              </span>
            )}
            {queuedCount > 0 && (
              <>
                <span className="text-border">·</span>
                <span>
                  <span className="font-semibold text-foreground">
                    {queuedCount}
                  </span>{" "}
                  queued
                </span>
              </>
            )}
            {completedCount > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-green-500" />
                  <span className="font-semibold text-foreground">
                    {completedCount}
                  </span>{" "}
                  completed
                </span>
              </>
            )}
            {failedCount > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-rose-500" />
                  <span className="font-semibold text-rose-600 dark:text-rose-400">
                    {failedCount}
                  </span>{" "}
                  failed
                </span>
              </>
            )}
          </div>

          {activeInstances.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              {activeInstances.map((instance) => (
                <div
                  key={instance.id}
                  className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1"
                >
                  <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
                  <span className="font-mono text-xs text-foreground">
                    {instance.agentType}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatUptime(instance.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
