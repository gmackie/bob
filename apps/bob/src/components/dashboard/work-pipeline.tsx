"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";

import { useTRPC } from "~/trpc/react";
import {
  formatPipelineStatus,
  groupWorkPipelineItems,
  type WorkPipelineItem,
} from "./work-pipeline-model";

interface WorkPipelineProps {
  workspaceId: string;
}

const LANES = [
  {
    key: "active",
    title: "Active Agents",
    empty: "No agents are running.",
    dot: "bg-amber-500 animate-pulse",
  },
  {
    key: "queued",
    title: "Ready to Start",
    empty: "No queued work is ready.",
    dot: "bg-blue-500",
  },
  {
    key: "review",
    title: "Review & Blockers",
    empty: "No review handoffs or blockers.",
    dot: "bg-rose-500",
  },
  {
    key: "done",
    title: "Done",
    empty: "No completed work yet.",
    dot: "bg-emerald-500",
  },
] as const;

function WorkRow({ item }: { item: WorkPipelineItem }) {
  const href =
    item.kind === "task"
      ? `/work-items/${item.id}/workspace`
      : `/work-items/${item.id}`;
  const agent = item.agentStatus;

  return (
    <Link
      href={href}
      className="group flex min-w-0 items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-xs text-primary" translate="no">
            {item.identifier}
          </span>
          <span className="truncate text-sm font-medium text-foreground">
            {item.title}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span>{formatPipelineStatus(item.status)}</span>
          {agent ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate" translate="no">
                {agent.agentType} {agent.status}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <span className="mt-0.5 shrink-0 text-xs text-muted-foreground group-hover:text-foreground">
        Open
      </span>
    </Link>
  );
}

export function WorkPipeline({ workspaceId }: WorkPipelineProps) {
  const trpc = useTRPC();
  const { data: workItems, isLoading } = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId, limit: 80 },
      { enabled: Boolean(workspaceId), refetchInterval: 10_000 },
    ),
  );

  const lanes = groupWorkPipelineItems((workItems ?? []) as WorkPipelineItem[]);

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">
            Work Pipeline
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Queue, active agents, review handoffs, and completed work.
          </p>
        </div>
        <Link
          href="/planning/board"
          className="rounded-md px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Board
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {LANES.map((lane) => (
            <div key={lane.key} className="h-32 animate-pulse rounded-lg bg-muted/40" />
          ))}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {LANES.map((lane) => {
            const items = lanes[lane.key].slice(0, 5);

            return (
              <section
                key={lane.key}
                className="min-w-0 rounded-lg border border-border/70 bg-background/40 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn("size-2 shrink-0 rounded-full", lane.dot)}
                      aria-hidden="true"
                    />
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {lane.title}
                    </h3>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {lanes[lane.key].length}
                  </span>
                </div>
                {items.length > 0 ? (
                  <div className="space-y-1">
                    {items.map((item) => (
                      <WorkRow key={item.id} item={item} />
                    ))}
                  </div>
                ) : (
                  <p className="px-2 py-4 text-sm text-muted-foreground">
                    {lane.empty}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
