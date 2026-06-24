"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";

import { useBobRpcClient } from "~/rpc/react";
import {
  buildRecentlyCompletedItems,
  buildWorkLaneSummaries,
  type DashboardTone,
  type WorkPipelineItem,
  getRecentlyCompletedRowModel,
  getRecentlyCompletedWorkItemHref,
  getWorkPipelineHeaderModel,
} from "./work-pipeline-model";
import { getPriorityQueueHref, getTaskLaneHref } from "~/components/tasks/task-shell-model";

interface WorkPipelineProps {
  workspaceId: string;
}

const TONE_CLASS: Record<DashboardTone, string> = {
  default: "text-muted-foreground bg-muted",
  warning: "text-amber-500 bg-amber-500/10",
  danger: "text-rose-500 bg-rose-500/10",
  success: "text-emerald-500 bg-emerald-500/10",
};

const DOT_CLASS: Record<DashboardTone, string> = {
  default: "bg-muted-foreground",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  success: "bg-emerald-500",
};

const TEXT_CLASS: Record<DashboardTone, string> = {
  default: "text-muted-foreground",
  warning: "text-amber-500",
  danger: "text-rose-500",
  success: "text-emerald-500",
};

function laneHref(lane: string, workspaceId: string): string {
  return getTaskLaneHref(lane, workspaceId);
}

export function WorkPipeline({ workspaceId }: WorkPipelineProps) {
  const rpc = useBobRpcClient();
  const input = { workspaceId, limit: 80 };
  const { data: workItems, isLoading } = useQuery({
    queryKey: ["rpc", "workItem.list", input],
    queryFn: () => rpc.workItems.list(input),
    enabled: Boolean(workspaceId),
    refetchInterval: 10_000,
  });

  const laneSummaries = buildWorkLaneSummaries((workItems ?? []) as WorkPipelineItem[]);
  const recentlyCompleted = buildRecentlyCompletedItems((workItems ?? []) as WorkPipelineItem[]);
  const header = getWorkPipelineHeaderModel();

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">
            {header.title}
          </h2>
          {header.subtitle ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {header.subtitle}
            </p>
          ) : null}
        </div>
        <Link
          href={getPriorityQueueHref(workspaceId)}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Priority Queue
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          {[1, 2, 3, 4].map((lane) => (
            <div key={lane} className="h-14 animate-pulse rounded-lg bg-muted/40" />
          ))}
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-2 md:grid-cols-4">
            {laneSummaries.map((lane) => (
              <Link
                key={lane.key}
                href={laneHref(lane.key, workspaceId)}
                className="min-w-0 rounded-lg border border-border/70 bg-background/40 px-3 py-2.5 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[lane.tone])}
                      aria-hidden="true"
                    />
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {lane.title}
                    </h3>
                  </div>
                  <span className={cn("text-xl font-semibold tabular-nums", TEXT_CLASS[lane.tone])}>
                    {lane.count}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                Recently Completed
              </h3>
              <span className="text-xs text-muted-foreground">
                {recentlyCompleted.length}
              </span>
            </div>
            {recentlyCompleted.length === 0 ? (
              <p className="rounded-lg bg-background/40 px-3 py-3 text-sm text-muted-foreground">
                No recently completed work yet.
              </p>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border/70 bg-background/40">
                {recentlyCompleted.map((item) => {
                  const row = getRecentlyCompletedRowModel(item);

                  return (
                    <Link
                      key={item.id}
                      href={getRecentlyCompletedWorkItemHref(item.id, workspaceId)}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted/30"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {item.identifier} · {item.title}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {item.kind}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs",
                          TONE_CLASS[row.statusTone],
                        )}
                      >
                        {row.statusLabel}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
