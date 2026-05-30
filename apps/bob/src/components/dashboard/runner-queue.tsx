"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";

import { useTRPC } from "~/trpc/react";

/**
 * Runner Queue — what the task runner is executing right now and what's waiting.
 *
 * Reuses the workspace-scoped agentRun.list query (live-refreshed) and splits it
 * into "Running" and "Queued" so the live runner state is visible at a glance.
 * Recent terminal runs live in the separate RecentRuns panel.
 */

interface RunnerQueueProps {
  workspaceId: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function QueueRow({ run, kind }: { run: any; kind: "running" | "queued" }) {
  const title = run.session?.title ?? run.workItemId ?? "Untitled";
  const displayTitle = title.length > 38 ? title.slice(0, 38) + "…" : title;
  return (
    <Link
      href={`/runs/${run.id}`}
      className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          kind === "running" ? "bg-amber-500 animate-pulse" : "bg-neutral-400",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {displayTitle}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {run.agentType}
        {kind === "running" && run.startedAt ? ` · ${timeAgo(run.startedAt)}` : ""}
      </span>
    </Link>
  );
}

export function RunnerQueue({ workspaceId }: RunnerQueueProps) {
  const trpc = useTRPC();

  const { data: runs, isLoading } = useQuery({
    ...trpc.agentRun.list.queryOptions({ workspaceId, limit: 50 }),
    enabled: !!workspaceId,
    refetchInterval: 5_000,
  });

  const all = (runs ?? []) as any[];
  const running = all.filter((r) => r.status === "running");
  const queued = all.filter((r) => r.status === "queued");

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-foreground">
          Runner Queue
        </h3>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {running.length} running · {queued.length} queued
        </span>
      </div>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-7 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      ) : running.length === 0 && queued.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Runner idle.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {running.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <p className="px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Running now
              </p>
              {running.map((run) => (
                <QueueRow key={run.id} run={run} kind="running" />
              ))}
            </div>
          )}
          {queued.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <p className="px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Queued
              </p>
              {queued.map((run) => (
                <QueueRow key={run.id} run={run} kind="queued" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
