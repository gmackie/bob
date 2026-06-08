"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";

import { useTRPC } from "~/trpc/react";
import { getPlanningDispatchHref } from "./planning-shell-model";

/**
 * Compact status bar shown on the planning page when a dispatch batch is
 * actively running. Polls every 10 seconds for fresh data.
 */
export function ActiveDispatchBar() {
  const trpc = useTRPC();

  const { data: batches } = useQuery(
    trpc.dispatch.listBatches.queryOptions(
      { limit: 1 },
      { refetchInterval: 10_000 },
    ),
  );

  const batch = batches?.[0];

  // Only show if the most recent batch is actively dispatching or running
  if (!batch || (batch.status !== "dispatching" && batch.status !== "running")) {
    return null;
  }

  const running =
    batch.totalTasks - batch.completedTasks - batch.failedTasks;
  const queued = Math.max(
    0,
    batch.totalTasks - batch.completedTasks - batch.failedTasks - running,
  );

  return (
    <div className="mb-4 flex items-center justify-between rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-sm text-foreground">
          Dispatching:{" "}
          <span className="text-foreground">
            {batch.completedTasks}/{batch.totalTasks}
          </span>{" "}
          complete
          {batch.failedTasks > 0 && (
            <span className="text-rose-400">
              , {batch.failedTasks} failed
            </span>
          )}
        </span>
      </div>
      <Link
        href={getPlanningDispatchHref(batch.id, batch.workspaceId)}
        className="text-sm text-blue-400 transition hover:text-blue-300"
      >
        View dispatch plan
      </Link>
    </div>
  );
}
