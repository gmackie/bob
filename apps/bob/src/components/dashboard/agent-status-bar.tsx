"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@bob/ui";
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

type StatusColor = "running" | "starting" | "stopped" | "error";

const statusDot: Record<StatusColor, string> = {
  running: "bg-blue-500 animate-pulse",
  starting: "bg-blue-400 animate-pulse",
  stopped: "bg-slate-400",
  error: "bg-rose-500",
};

export function AgentStatusBar() {
  const trpc = useTRPC();
  const { data: instances, isLoading } = useQuery(
    trpc.instance.list.queryOptions(),
  );

  if (isLoading) {
    return (
      <div className="h-10 animate-pulse rounded-xl bg-muted/50" />
    );
  }

  const active = instances?.filter(
    (i) => i.status === "running" || i.status === "starting",
  ) ?? [];
  const idle = instances?.filter((i) => i.status === "stopped") ?? [];
  const errored = instances?.filter((i) => i.status === "error") ?? [];

  const hasError = errored.length > 0;
  const hasIdle = idle.length > 0;
  const allRunning = active.length > 0 && !hasError && !hasIdle;

  const barColor = hasError
    ? "border-rose-500/20 bg-rose-50 dark:bg-rose-950/20"
    : hasIdle
      ? "border-amber-500/20 bg-amber-50 dark:bg-amber-950/20"
      : allRunning
        ? "border-blue-500/20 bg-blue-50 dark:bg-blue-950/20"
        : "border-border bg-card";

  const isEmpty = !instances || instances.length === 0;

  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-2xl border px-5 py-2.5",
        barColor,
      )}
    >
      {isEmpty ? (
        <span className="font-body text-sm text-muted-foreground">
          No active agents
        </span>
      ) : (
        <>
          {/* Summary counts */}
          <div className="flex items-center gap-3 font-body text-sm text-muted-foreground">
            {active.length > 0 && (
              <span>
                <span className="font-semibold text-foreground">
                  {active.length}
                </span>{" "}
                agent{active.length !== 1 ? "s" : ""} running
              </span>
            )}
            {idle.length > 0 && (
              <>
                <span className="text-border">·</span>
                <span>
                  <span className="font-semibold text-foreground">
                    {idle.length}
                  </span>{" "}
                  idle
                </span>
              </>
            )}
            {errored.length > 0 && (
              <>
                <span className="text-border">·</span>
                <span>
                  <span className="font-semibold text-rose-600 dark:text-rose-400">
                    {errored.length}
                  </span>{" "}
                  errored
                </span>
              </>
            )}
          </div>

          {/* Agent pills */}
          <div className="ml-auto flex items-center gap-2">
            {instances
              ?.filter((i) => i.status !== "stopped")
              .map((instance) => (
                <div
                  key={instance.id}
                  className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1"
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      statusDot[instance.status as StatusColor] ??
                        statusDot.stopped,
                    )}
                  />
                  <span className="font-mono text-xs text-foreground">
                    {instance.agentType}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatUptime(instance.createdAt)}
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
