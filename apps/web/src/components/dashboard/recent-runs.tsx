"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@bob/ui";

import { useTRPC } from "~/trpc/react";

const STATUS_DOT: Record<string, string> = {
  queued: "bg-neutral-400",
  running: "bg-amber-500 animate-pulse",
  completed: "bg-green-500",
  failed: "bg-red-500",
};

interface RecentRunsProps {
  workspaceId: string;
}

export function RecentRuns({ workspaceId }: RecentRunsProps) {
  const trpc = useTRPC();

  const { data: runs, isLoading } = useQuery(
    trpc.agentRun.list.queryOptions(
      { workspaceId, limit: 5 },
      { enabled: !!workspaceId, refetchInterval: 10_000 },
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
          No agent runs yet. Run{" "}
          <code className="font-mono">bob run</code> to get started.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {(runs as any[]).map((run) => (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors"
            >
              <div
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  STATUS_DOT[run.status] ?? STATUS_DOT.queued,
                )}
              />
              <span className="font-mono text-xs text-neutral-500">
                {run.workItemId}
              </span>
              <span className="text-xs">{run.agentType}</span>
              <span className="text-muted-foreground ml-auto text-xs">
                {run.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
