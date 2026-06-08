"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";

import { useTRPC } from "~/trpc/react";
import {
  filterWorkLaneItems,
  getWorkLaneEntryHref,
  getWorkLaneRowModel,
  getWorkLaneTableHeaderModel,
  type DashboardTone,
  type WorkLaneKey,
  type WorkPipelineItem,
} from "./work-pipeline-model";

const STATUS_CLASS: Record<DashboardTone, string> = {
  default: "bg-muted text-muted-foreground",
  warning: "bg-amber-500/10 text-amber-500",
  danger: "bg-rose-500/10 text-rose-500",
  success: "bg-emerald-500/10 text-emerald-500",
};

export function WorkLaneTable({
  workspaceId,
  lane,
}: {
  workspaceId?: string;
  lane: WorkLaneKey;
}) {
  const trpc = useTRPC();
  const { data: workItems, isLoading } = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId: workspaceId ?? "", limit: 100 },
      { enabled: Boolean(workspaceId), refetchInterval: 10_000 },
    ),
  );
  const items = filterWorkLaneItems((workItems ?? []) as WorkPipelineItem[], lane);
  const header = getWorkLaneTableHeaderModel(lane);

  if (!workspaceId) {
    return (
      <div className="rounded-lg border border-dashed border-border px-8 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Select a workspace to view this task table.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h1 className="font-display text-lg font-semibold text-foreground">
            {header.title}
          </h1>
          {header.subtitle ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {header.subtitle}
            </p>
          ) : null}
        </div>
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">
          {items.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-semibold">ID</th>
              <th className="px-5 py-3 font-semibold">Title</th>
              <th className="px-5 py-3 font-semibold">Kind</th>
              <th className="px-5 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [0, 1, 2].map((row) => (
                <tr key={row} className="border-b border-border">
                  <td className="px-5 py-4" colSpan={4}>
                    <div className="h-4 animate-pulse rounded bg-muted/50" />
                  </td>
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td className="px-5 py-6 text-muted-foreground" colSpan={4}>
                  No work items in this state.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const row = getWorkLaneRowModel(item, lane);

                return (
                  <tr key={item.id} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-3 font-medium text-muted-foreground">
                      {item.identifier}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={getWorkLaneEntryHref(item, lane, workspaceId)}
                        className="font-medium text-foreground transition-colors hover:text-primary"
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {item.kind}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          STATUS_CLASS[row.statusTone],
                        )}
                      >
                        {row.statusLabel}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
