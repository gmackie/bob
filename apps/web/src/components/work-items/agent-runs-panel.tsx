"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@bob/ui";
import { Card } from "@bob/ui/card";
import { Badge } from "@bob/ui/badge";

import { useTRPC } from "~/trpc/react";

const STATUS_COLORS: Record<string, string> = {
  queued:
    "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  running:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  completed:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

interface AgentRunsPanelProps {
  workItemId: string;
  workspaceId: string;
}

export function AgentRunsPanel({
  workItemId,
  workspaceId,
}: AgentRunsPanelProps) {
  const trpc = useTRPC();

  const { data: runs } = useQuery(
    trpc.publicApi.listRunsByWorkItem.queryOptions(
      { workItemId, limit: 20 },
      { enabled: !!workItemId, refetchInterval: 10_000 },
    ),
  );

  if (!runs?.length) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Agent Runs</h3>
        <Link
          href="/runs"
          className="text-primary text-xs hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        {runs.map((run: any) => (
          <Link key={run.id} href={`/runs/${run.id}`}>
            <Card className="hover:border-primary/30 flex items-center gap-3 p-3 transition-colors">
              <Badge
                className={cn(
                  "shrink-0 text-xs",
                  STATUS_COLORS[run.status] ?? STATUS_COLORS.queued,
                )}
              >
                {run.status}
              </Badge>
              <span className="text-sm font-medium">{run.agentType}</span>
              {run.summary?.duration_ms && (
                <span className="text-muted-foreground text-xs">
                  {run.summary.duration_ms < 1000
                    ? `${run.summary.duration_ms}ms`
                    : `${(run.summary.duration_ms / 1000).toFixed(1)}s`}
                </span>
              )}
              <span className="text-muted-foreground ml-auto text-xs">
                {run.artifacts?.length ?? 0} artifacts
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
