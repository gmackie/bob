"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";
import { Card } from "@bob/ui/card";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { useTRPC } from "~/trpc/react";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  running: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatRelativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export default function RunsPage() {
  const trpc = useTRPC();
  const searchParams = useSearchParams();
  const workspaceId = searchParams?.get("workspace") ?? "";

  // Fetch workspaces to get the first one if no workspace param
  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );
  const workspaces = (workspaceMemberships ?? [])
    .map((m: any) => m.workspace)
    .filter(Boolean);
  const activeWorkspaceId = workspaceId || workspaces?.[0]?.id || "";

  const { data: runs, isLoading } = useQuery(
    trpc.publicApi.listRuns.queryOptions(
      { workspaceId: activeWorkspaceId, limit: 50 },
      { enabled: !!activeWorkspaceId, refetchInterval: 10_000 },
    ),
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs items={[{ label: "Runs" }]} />

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Agent Runs
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What your agents did, whether it worked, and what changed.
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-muted/50 h-20 animate-pulse rounded-lg"
            />
          ))}
        </div>
      ) : !runs?.length ? (
        <Card className="p-8 text-center">
          <h3 className="font-display text-lg font-semibold">No runs yet</h3>
          <p className="text-muted-foreground mt-2 text-sm">
            Run <code className="font-mono text-xs">bob run &lt;work-item-id&gt;</code> to launch an agent and see results here.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {runs.map((run: any) => (
            <Link key={run.id} href={`/runs/${run.id}`}>
              <Card className="hover:border-primary/30 flex items-center gap-4 p-4 transition-colors">
                {/* Status badge */}
                <Badge
                  className={cn(
                    "shrink-0 text-xs font-medium",
                    STATUS_COLORS[run.status] ?? STATUS_COLORS.queued,
                  )}
                >
                  {run.status}
                </Badge>

                {/* Main info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/work-items/${run.workItemId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-xs font-medium text-neutral-500 hover:text-primary hover:underline"
                    >
                      {run.workItemId}
                    </Link>
                    <span className="text-muted-foreground text-xs">via</span>
                    <span className="text-sm font-medium">{run.agentType}</span>
                  </div>
                  {run.summary && (
                    <div className="text-muted-foreground mt-0.5 flex gap-3 text-xs">
                      {run.summary.files_changed > 0 && (
                        <span>{run.summary.files_changed} files changed</span>
                      )}
                      {run.summary.duration_ms && (
                        <span>{formatDuration(run.summary.duration_ms)}</span>
                      )}
                      {run.summary.exit_code !== undefined &&
                        run.summary.exit_code !== 0 && (
                          <span className="text-red-500">
                            exit {run.summary.exit_code}
                          </span>
                        )}
                    </div>
                  )}
                </div>

                {/* Artifact count */}
                {run.artifacts?.length > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {run.artifacts.length} artifact
                    {run.artifacts.length !== 1 ? "s" : ""}
                  </span>
                )}

                {/* Time */}
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatRelativeTime(run.createdAt)}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
