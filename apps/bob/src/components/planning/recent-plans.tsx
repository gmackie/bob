"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@gmacko/core/ui/badge";

import { useBobRpcClient } from "~/rpc/react";
import { getPlanningSessionHref } from "./planning-shell-model";
import {
  formatPlanningSessionOutputLabel,
  formatPlanningSessionStatus,
  type PlanningDashboardSession,
} from "./planning-dashboard-model";

interface RecentPlansProps {
  sessions?: PlanningDashboardSession[];
  isLoading?: boolean;
  workspaceId?: string | null;
}

function formatRelativeDate(value?: string | Date | null): string {
  if (!value) return "No activity";
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return "No activity";

  const now = new Date();
  const diffMs = now.getTime() - time;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

const STATUS_VARIANT: Record<string, "default" | "slate" | "blue" | "amber" | "emerald" | "rose"> = {
  provisioning: "amber",
  running: "blue",
  stopped: "slate",
  completed: "emerald",
  failed: "rose",
};

export function RecentPlans({
  sessions: providedSessions,
  isLoading: providedLoading,
  workspaceId,
}: RecentPlansProps = {}) {
  const rpc = useBobRpcClient();

  const { data: queriedSessions, isLoading: queryLoading } = useQuery({
    queryKey: ["rpc", "planning.session.list", { limit: 5 }],
    queryFn: () =>
      rpc.planning.session.list({ limit: 5 }) as Promise<
        PlanningDashboardSession[]
      >,
    enabled: providedSessions === undefined,
  });
  const sessions = providedSessions ?? ((queriedSessions ?? []) as unknown as PlanningDashboardSession[]);
  const isLoading = providedLoading ?? queryLoading;

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-10 rounded-lg bg-card"
          />
        ))}
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-6 text-center">
        <div className="text-sm text-muted-foreground">No planning sessions yet.</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Start a planning session to break goals into actionable tasks.
        </div>
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {sessions.map((session) => (
        <li key={session.id}>
          <Link
            href={getPlanningSessionHref(session.id, workspaceId)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-accent"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {session.title ?? "Untitled session"}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {formatPlanningSessionOutputLabel(session)}
              </span>
            </span>
            <Badge
              variant={STATUS_VARIANT[session.status ?? ""] ?? "slate"}
              className="shrink-0 text-[10px]"
            >
              {formatPlanningSessionStatus(session.status)}
            </Badge>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatRelativeDate(session.updatedAt ?? session.createdAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
