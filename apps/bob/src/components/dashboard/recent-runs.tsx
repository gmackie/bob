"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";

import { useTRPC } from "~/trpc/react";

const STATUS_DOT: Record<string, string> = {
  queued: "bg-neutral-400",
  running: "bg-amber-500 animate-pulse",
  completed: "bg-green-500",
  failed: "bg-red-500",
  interrupted: "bg-orange-400",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface RecentRunsProps {
  workspaceId: string;
}

export function RecentRuns({ workspaceId }: RecentRunsProps) {
  const trpc = useTRPC();

  const { data: runs, isLoading } = useQuery(
    workspaceId
      ? trpc.agentRun.list.queryOptions(
          { workspaceId, limit: 8 },
          { refetchInterval: 10_000 },
        )
      : trpc.agentRun.listAll.queryOptions(
          { limit: 8 },
          { refetchInterval: 10_000 },
        ),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Recent Runs</h3>
        <Link
          href="/runs"
          className="text-primary text-xs hover:underline"
        >
          View all
        </Link>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-muted/50 h-10 animate-pulse rounded"
            />
          ))}
        </div>
      ) : !runs?.length ? (
        <p className="text-muted-foreground text-xs">
          No agent runs yet.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {(runs as any[]).map((run) => {
            const title =
              run.session?.title ?? run.workItemId ?? "Untitled";
            const displayTitle =
              title.length > 40 ? title.slice(0, 40) + "..." : title;

            return (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="hover:bg-muted/50 group flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors"
              >
                <div
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    STATUS_DOT[run.status] ?? STATUS_DOT.queued,
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium">
                      {displayTitle}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{run.agentType}</span>
                    <span>·</span>
                    <span>{timeAgo(run.createdAt)}</span>
                  </div>
                </div>
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                    run.status === "completed" &&
                      "bg-green-500/10 text-green-600 dark:text-green-400",
                    run.status === "running" &&
                      "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                    run.status === "failed" &&
                      "bg-red-500/10 text-red-600 dark:text-red-400",
                    run.status === "interrupted" &&
                      "bg-orange-500/10 text-orange-600 dark:text-orange-400",
                    run.status === "queued" &&
                      "bg-neutral-500/10 text-neutral-500",
                  )}
                >
                  {run.status}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
