"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@gmacko/core/ui/badge";

import { STATUS_COLOR, formatLabel } from "~/lib/design/colors";
import { useBobRpcClient } from "~/rpc/react";

interface LinearProgressProps {
  workspaceId: string;
}

// Display order for the status breakdown chips. Mirrors the work-item
// lifecycle; only non-zero buckets render.
const STATUS_ORDER = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "canceled",
] as const;

// Statuses that count as "resolved" for the progress bar.
const DONE_STATUSES = new Set(["done", "canceled"]);

/**
 * Rollup of Linear-synced issues by status — answers "N Linear issues, X in
 * progress, Y in review, Z done, blocked" at a glance. Self-hides when the
 * workspace has no Linear issues, so it only appears where it's relevant.
 */
export function LinearProgress({ workspaceId }: LinearProgressProps) {
  const rpc = useBobRpcClient();
  const input = { workspaceId, externalProvider: "linear" };

  const { data: counts, isLoading } = useQuery({
    queryKey: ["rpc", "workItem.statusCounts", input],
    queryFn: () =>
      rpc.workItems.statusCounts(input) as Promise<Record<string, number>>,
    enabled: Boolean(workspaceId),
    refetchInterval: 30_000,
  });

  const map = (counts ?? {}) as Record<string, number>;
  const total = Object.values(map).reduce((sum, n) => sum + n, 0);
  const doneCount = Object.entries(map).reduce(
    (sum, [status, n]) => (DONE_STATUSES.has(status) ? sum + n : sum),
    0,
  );

  // Nothing synced (or still loading the first time) → don't clutter the board.
  if (isLoading || total === 0) return null;

  const pct = Math.round((doneCount / total) * 100);

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-sm font-semibold text-foreground">
            Linear Issues
          </h2>
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">
            {total}
          </span>
        </div>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {pct}% resolved
        </span>
      </div>

      {/* Progress bar: resolved (done + canceled) of total. */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Status breakdown chips — only non-zero buckets. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_ORDER.filter((status) => (map[status] ?? 0) > 0).map((status) => (
          <Badge key={status} variant={STATUS_COLOR[status] ?? "slate"}>
            {formatLabel(status)}
            <span className="ml-1.5 tabular-nums opacity-80">{map[status]}</span>
          </Badge>
        ))}
      </div>

      <Link
        href={`/tasks?workspace=${workspaceId}`}
        className="mt-4 inline-flex text-xs font-medium text-primary hover:text-primary/80"
      >
        View all issues
      </Link>
    </section>
  );
}
