"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { useBobRpcClient } from "~/rpc/react";
import { getRunningNowScope } from "./work-pipeline-model";
import {
  buildRunningNowRailRows,
  type RunningNowWorkItemLike,
  type RunningNowRailStatusTone,
} from "./running-now-rail-model";

const STATUS_DOT_CLASS: Record<RunningNowRailStatusTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  default: "bg-muted-foreground",
};

const STATUS_BADGE_CLASS: Record<RunningNowRailStatusTone, string> = {
  success: "bg-emerald-500/10 text-emerald-500",
  warning: "bg-amber-500/10 text-amber-500",
  danger: "bg-rose-500/10 text-rose-500",
  default: "bg-muted text-muted-foreground",
};

export function RunningNowRail({ workspaceId }: { workspaceId?: string | null }) {
  const rpc = useBobRpcClient();
  const scope = getRunningNowScope(workspaceId);
  const { data: runs, isLoading } = useQuery({
    queryKey: [
      "running-now",
      "runs",
      scope.mode,
      scope.mode === "workspace" ? scope.workspaceId : "all",
    ],
    queryFn: () =>
      scope.mode === "workspace"
        ? (rpc.agent.listRuns({
            workspaceId: scope.workspaceId,
            limit: 100,
          }) as Promise<unknown[]>)
        : (rpc.agent.listAllRuns({ limit: 100 }) as Promise<unknown[]>),
    refetchInterval: 10_000,
  });
  const { data: workItems, isLoading: workItemsLoading } = useQuery({
    queryKey: ["running-now", "work-items", workspaceId ?? ""],
    queryFn: () =>
      rpc.workItems.list({
        workspaceId: workspaceId ?? "",
        limit: 100,
      }) as Promise<unknown[]>,
    enabled: Boolean(workspaceId),
    refetchInterval: 10_000,
  });

  const activeRuns = ((runs ?? []) as {
    id: string;
    title?: string | null;
    status: string;
    agentType?: string | null;
    workspaceId?: string | null;
    workItemId?: string | null;
    sessionId?: string | null;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
    lastActivityAt?: string | Date | null;
  }[]);
  const visibleRuns = buildRunningNowRailRows({
    runs: activeRuns,
    workItems: (workItems ?? []) as RunningNowWorkItemLike[],
    workspaceId,
  });
  const loading = isLoading || workItemsLoading;

  return (
    <aside className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-sm font-semibold text-foreground">
          Running Now
        </h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {visibleRuns.length}
        </span>
      </div>

      {loading ? (
        <div className="mt-3 space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      ) : visibleRuns.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No execution sessions are currently in progress.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          {visibleRuns.map((run) => (
            <Link
              key={run.id}
              href={run.href}
              className="rounded-md px-2 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full animate-pulse ${STATUS_DOT_CLASS[run.statusTone]}`} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {run.title}
                </span>
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${STATUS_BADGE_CLASS[run.statusTone]}`}>
                  {run.statusLabel}
                </span>
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 pl-4 text-[10px] text-muted-foreground">
                <span className="truncate rounded-full bg-muted px-1.5 py-0.5 font-semibold" translate="no">
                  {run.agentLabel}
                </span>
                <span className="shrink-0">
                  {run.lastUpdatedLabel}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}
