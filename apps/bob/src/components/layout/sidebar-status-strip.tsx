"use client";

/**
 * The status strip at the bottom of the sidebar. Reads the workspace's host
 * snapshot from the react-query cache that use-workspace-events keeps warm
 * from the gateway socket, so it costs no request and moves on every
 * heartbeat. Links to Nodes, where the detail is.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";
import type { HostSnapshotWire } from "@bob/ws";

import { buildSidebarStatus, type SidebarStatusTone } from "./sidebar-status-model";

const DOT: Record<SidebarStatusTone, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  grey: "bg-neutral-400",
};

const TEXT: Record<SidebarStatusTone, string> = {
  green: "text-emerald-700 dark:text-emerald-300",
  amber: "text-amber-700 dark:text-amber-300",
  red: "text-rose-700 dark:text-rose-300",
  grey: "text-muted-foreground",
};

export function SidebarStatusStrip({ workspaceId, collapsed }: { workspaceId: string; collapsed: boolean }) {
  // The cache entry is written by the socket hook; there is nothing to fetch.
  const { data: snapshot } = useQuery<HostSnapshotWire | null>({
    queryKey: ["hostSnapshot", workspaceId],
    queryFn: () => null,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const status = buildSidebarStatus(snapshot ?? null);

  return (
    <Link
      href={status.href}
      className={cn(
        "mt-2 flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-accent",
        collapsed && "justify-center px-0",
      )}
      title={collapsed ? status.headline : undefined}
      data-testid="sidebar-status-strip"
      aria-label={`System status: ${status.headline}`}
    >
      <span className={cn("mt-1 inline-block size-2 shrink-0 rounded-full", DOT[status.tone])} />
      {!collapsed ? (
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium", TEXT[status.tone])}>{status.headline}</span>
          {status.rows.length > 0 ? (
            <span className="mt-0.5 block truncate text-muted-foreground">
              {status.rows.map((row) => `${row.label} ${row.value}`).join(" · ")}
            </span>
          ) : status.detail ? (
            <span className="mt-0.5 block truncate text-muted-foreground">{status.detail}</span>
          ) : null}
        </span>
      ) : null}
    </Link>
  );
}
