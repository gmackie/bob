"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { cn } from "@gmacko/core/ui";
import { Badge } from "@gmacko/core/ui/badge";
import { Card } from "@gmacko/core/ui/card";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { useTRPC } from "~/trpc/react";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  running: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  interrupted: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
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

function isNodeOnline(lastHeartbeat: string | null): boolean {
  if (!lastHeartbeat) return false;
  return Date.now() - new Date(lastHeartbeat).getTime() < 5 * 60 * 1000;
}

export default function RunsPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams?.get("workspace") ?? "";
  const [fleetExpanded, setFleetExpanded] = useState(false);

  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );
  const workspaces = (workspaceMemberships ?? [])
    .map((m: any) => m.workspace)
    .filter(Boolean);

  const { data: runs, isLoading } = useQuery(
    workspaceId
      ? trpc.agentRun.list.queryOptions(
          { workspaceId, limit: 50 },
          { refetchInterval: 10_000 },
        )
      : trpc.agentRun.listAll.queryOptions(
          { limit: 50 },
          { refetchInterval: 10_000 },
        ),
  );

  const { data: instances } = useQuery(
    trpc.instance.list.queryOptions(undefined, { staleTime: 30_000 }),
  );

  // Fleet stats
  const onlineNodes = workspaces.filter((w: any) => isNodeOnline(w.lastHeartbeat));
  const activeRuns = (runs ?? []).filter((r: any) => r.status === "running");
  const todayRuns = (runs ?? []).filter((r: any) => {
    const created = new Date(r.createdAt);
    const today = new Date();
    return created.toDateString() === today.toDateString();
  });

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

      {/* Workspace filter */}
      {workspaces.length > 1 && (
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <button
            onClick={() => router.push("/runs")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              !workspaceId
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            All
          </button>
          {workspaces.map((ws: any) => (
            <button
              key={ws.id}
              onClick={() => router.push(`/runs?workspace=${ws.id}`)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                ws.id === workspaceId
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              {ws.name || ws.machineId || ws.id.slice(0, 8)}
            </button>
          ))}
        </div>
      )}

      {/* Fleet Status Bar */}
      <button
        onClick={() => setFleetExpanded((p) => !p)}
        className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/50"
      >
        <div className="flex items-center gap-2">
          <span className={cn(
            "size-2 rounded-full",
            onlineNodes.length > 0 ? "bg-green-500" : "bg-neutral-400",
          )} />
          <span className="text-sm font-medium">
            {onlineNodes.length} node{onlineNodes.length !== 1 ? "s" : ""} online
          </span>
        </div>
        <span className="text-muted-foreground text-xs">·</span>
        <span className="text-sm">
          {activeRuns.length} running
        </span>
        <span className="text-muted-foreground text-xs">·</span>
        <span className="text-sm text-muted-foreground">
          {todayRuns.length} today
        </span>
        <svg
          className={cn(
            "ml-auto size-4 text-muted-foreground transition-transform",
            fleetExpanded && "rotate-180",
          )}
          viewBox="0 0 15 15"
          fill="currentColor"
        >
          <path d="M3.13 5.16a.5.5 0 0 1 .71 0L7.5 8.82l3.66-3.66a.5.5 0 0 1 .71.71l-4.01 4.01a.5.5 0 0 1-.71 0L3.13 5.87a.5.5 0 0 1 0-.71Z" />
        </svg>
      </button>

      {/* Expanded Fleet Panel */}
      {fleetExpanded && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground col-span-full">
              No nodes registered. Run <code className="font-mono text-xs">bob init</code> to register a workspace.
            </p>
          ) : (
            workspaces.map((ws: any) => {
              const online = isNodeOnline(ws.lastHeartbeat);
              return (
                <Card key={ws.id} className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={cn(
                      "size-2 rounded-full",
                      online ? "bg-green-500" : "bg-neutral-400",
                    )} />
                    <span className="text-sm font-medium truncate">
                      {ws.machineId || ws.name || ws.slug}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>{online ? "Online" : "Offline"} · {ws.lastHeartbeat ? formatRelativeTime(ws.lastHeartbeat) : "never"}</p>
                    {ws.agentConfigs && (
                      <p>Agents: {Object.keys(ws.agentConfigs).join(", ") || "none configured"}</p>
                    )}
                  </div>
                </Card>
              );
            })
          )}

          {/* Agent instances */}
          {(instances ?? []).length > 0 && (
            <>
              <div className="col-span-full mt-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Agent Instances
              </div>
              {(instances as any[]).map((inst: any) => (
                <Card key={inst.id} className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={inst.status === "running" ? "default" : "slate"} className="text-[10px]">
                      {inst.status}
                    </Badge>
                    <span className="text-sm font-medium">{inst.agentType}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(inst.createdAt)}
                  </p>
                </Card>
              ))}
            </>
          )}
        </div>
      )}

      {/* Runs List */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-muted/50 h-20 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : !runs?.length ? (
        <Card className="p-8">
          <h3 className="font-display text-lg font-semibold">
            Welcome to blder.bot
          </h3>
          <p className="text-muted-foreground mt-2 text-sm">
            See what your agents did, understand the changes, and ship with confidence.
          </p>
          <div className="mt-6 space-y-4">
            {[
              { step: 1, title: "Install bob", code: "brew install blder/tap/bob" },
              { step: 2, title: "Generate an API key", link: { href: "/settings?section=api-keys", text: "Settings → API Keys" } },
              { step: 3, title: "Authenticate", code: "bob login --api-key YOUR_KEY" },
              { step: 4, title: "Initialize a workspace", code: "cd your-project && bob init" },
              { step: 5, title: "Run your first agent", code: "bob run <work-item-id> --agent claude-code" },
            ].map(({ step, title, code, link }) => (
              <div key={step} className="flex items-start gap-3">
                <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                  {step}
                </span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  {code && (
                    <code className="bg-muted mt-1 block rounded px-3 py-2 font-mono text-xs">{code}</code>
                  )}
                  {link && (
                    <p className="text-muted-foreground text-xs">
                      Go to <Link href={link.href} className="text-primary hover:underline">{link.text}</Link> and create a key for the CLI.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {runs.map((run: any) => {
            const title = run.session?.title ?? run.workItemId ?? "Untitled";
            return (
            <Link key={run.id} href={`/runs/${run.id}`}>
              <Card className="hover:border-primary/30 flex items-center gap-4 p-4 transition-colors">
                <Badge className={cn("shrink-0 text-xs font-medium", STATUS_COLORS[run.status] ?? STATUS_COLORS.queued)}>
                  {run.status}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {title}
                    </span>
                    <span className="text-muted-foreground text-xs">via</span>
                    <span className="text-xs font-medium text-muted-foreground">{run.agentType}</span>
                  </div>
                  {run.summary && (
                    <div className="text-muted-foreground mt-0.5 flex gap-3 text-xs">
                      {run.summary.files_changed > 0 && <span>{run.summary.files_changed} files</span>}
                      {run.summary.duration_ms && <span>{formatDuration(run.summary.duration_ms)}</span>}
                      {run.summary.exit_code !== undefined && run.summary.exit_code !== 0 && (
                        <span className="text-red-500">exit {run.summary.exit_code}</span>
                      )}
                    </div>
                  )}
                </div>
                {run.artifacts?.length > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {run.artifacts.length} artifact{run.artifacts.length !== 1 ? "s" : ""}
                  </span>
                )}
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatRelativeTime(run.createdAt)}
                </span>
              </Card>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
