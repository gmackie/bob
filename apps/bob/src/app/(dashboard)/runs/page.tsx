"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { cn } from "@gmacko/core/ui";
import { Badge } from "@gmacko/core/ui/badge";
import { Card } from "@gmacko/core/ui/card";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import {
  buildProviderRunRow,
  buildProviderRunGroups,
  filterRunsByProvider,
  filterRecentOutcomeRuns,
  getProviderRunsEmptyState,
  getProviderRunsHeaderModel,
  getProviderRunsFilterHref,
  normalizeProviderParam,
} from "~/components/dashboard/provider-runs-model";
import { useTRPC } from "~/trpc/react";
import { DeviceHeartbeatsSection } from "../settings/_components/device-heartbeats";

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  running: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "awaiting-input": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  awaiting_input: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  interrupted: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};

const ROW_STATUS_COLORS: Record<string, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/10 text-emerald-500",
  warning: "bg-amber-500/10 text-amber-500",
  danger: "bg-rose-500/10 text-rose-500",
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

interface WorkspaceMembership {
  workspace?: {
    id: string;
    name?: string | null;
    slug?: string | null;
    lastHeartbeat?: string | null;
  } | null;
}

interface AgentInstance {
  id: string;
  status: string;
  agentType: string;
  workspaceId?: string | null;
  lastHeartbeat?: string | null;
  createdAt: string;
}

function ProviderMetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "success" && "text-emerald-500",
          tone === "warning" && "text-amber-500",
          tone === "danger" && "text-rose-500",
        )}
      >
        {value}
      </p>
    </Card>
  );
}

function ProviderRunRow({
  run,
  workspaceId,
}: {
  run: any;
  workspaceId?: string | null;
}) {
  const row = buildProviderRunRow(run, workspaceId);

  return (
    <Link href={row.href}>
      <Card
        aria-label={row.accessibilityLabel}
        className="hover:border-primary/30 flex items-center gap-4 p-4 transition-colors"
      >
        <Badge className={cn("shrink-0 text-xs font-medium", ROW_STATUS_COLORS[row.statusTone])}>
          {row.statusLabel}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {row.title}
            </span>
            <span className="text-muted-foreground text-xs">via</span>
            <span className="text-xs font-medium text-muted-foreground">{row.agentLabel}</span>
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
        {run.workItemId ? (
          <span className="hidden max-w-[10rem] truncate text-xs text-muted-foreground md:inline">
            {run.workItemId}
          </span>
        ) : null}
        {run.artifacts?.length > 0 && (
          <span className="text-muted-foreground text-xs">
            {run.artifacts.length} artifact{run.artifacts.length !== 1 ? "s" : ""}
          </span>
        )}
        <span className="text-muted-foreground shrink-0 text-xs">
          {row.lastUpdatedLabel}
        </span>
      </Card>
    </Link>
  );
}

function ProviderRunSection({
  title,
  runs,
  empty,
  workspaceId,
}: {
  title: string;
  runs: any[];
  empty: string;
  workspaceId?: string | null;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-foreground">
          {title}
        </h2>
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {runs.length}
        </span>
      </div>
      {runs.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">{empty}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {runs.map((run) => (
            <ProviderRunRow key={run.id} run={run} workspaceId={workspaceId} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function RunsPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams?.get("workspace") ?? "";
  const provider = normalizeProviderParam(searchParams?.get("provider") ?? null);
  const [fleetExpanded, setFleetExpanded] = useState(false);

  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );
  const workspaceRows = (Array.isArray(workspaceMemberships)
    ? workspaceMemberships
    : []) as WorkspaceMembership[];
  const workspaces = workspaceRows
    .map((m) => m.workspace)
    .filter((workspace): workspace is NonNullable<WorkspaceMembership["workspace"]> =>
      Boolean(workspace),
    );

  // agentRun.list and agentRun.listAll return differently-shaped rows
  // (workspace-scoped vs. global), so their queryOptions types don't unify.
  // Both run results are consumed as any[] below; cast to one branch's shape.
  const runsQueryOptions = (
    workspaceId
      ? trpc.agentRun.list.queryOptions(
          { workspaceId, limit: 50 },
          { refetchInterval: 10_000 },
        )
      : trpc.agentRun.listAll.queryOptions(
          { limit: 50 },
          { refetchInterval: 10_000 },
        )
  ) as ReturnType<typeof trpc.agentRun.listAll.queryOptions>;

  const { data: runs, isLoading } = useQuery(runsQueryOptions);

  const { data: instances } = useQuery(
    trpc.instance.list.queryOptions(undefined, { staleTime: 30_000 }),
  );

  const providerFilteredRuns = filterRunsByProvider((runs ?? []) as any[], provider);
  const filteredRuns = provider === "all"
    ? filterRecentOutcomeRuns(providerFilteredRuns)
    : providerFilteredRuns;
  const providerGroups = buildProviderRunGroups(filteredRuns);
  const providerHeader = getProviderRunsHeaderModel(provider);
  const emptyState = getProviderRunsEmptyState(provider);

  // Fleet stats
  const onlineNodes = workspaces.filter((w: any) => isNodeOnline(w.lastHeartbeat));
  const activeRuns = filteredRuns.filter((r: any) => r.status === "running");
  const todayRuns = filteredRuns.filter((r: any) => {
    const created = new Date(r.createdAt);
    const today = new Date();
    return created.toDateString() === today.toDateString();
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs items={[{ label: "Runs" }]} />

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {providerHeader.title}
        </h1>
        {providerHeader.subtitle ? (
          <p className="text-muted-foreground mt-1 text-sm">
            {providerHeader.subtitle}
          </p>
        ) : null}
      </div>

      <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-card p-1">
        {[
          { key: "all", label: "All" },
          { key: "claude", label: "Claude" },
          { key: "codex", label: "Codex" },
          { key: "cursor", label: "Cursor" },
          { key: "grok", label: "Grok" },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => {
              router.push(getProviderRunsFilterHref(searchParams?.toString() ?? "", {
                provider: item.key as "all" | "claude" | "codex" | "cursor" | "grok",
              }));
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              provider === item.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Workspace filter */}
      {workspaces.length > 1 && (
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <button
            onClick={() =>
              router.push(getProviderRunsFilterHref(searchParams?.toString() ?? "", {
                workspaceId: null,
              }))
            }
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
              onClick={() =>
                router.push(getProviderRunsFilterHref(searchParams?.toString() ?? "", {
                  workspaceId: ws.id,
                }))
              }
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
              {((instances ?? []) as AgentInstance[]).map((inst) => (
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

      {provider !== "all" && !isLoading ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <ProviderMetricCard label="Total" value={providerGroups.metrics.total} />
          <ProviderMetricCard label="Active" value={providerGroups.metrics.active} tone="warning" />
          <ProviderMetricCard label="Completed" value={providerGroups.metrics.completed} tone="success" />
          <ProviderMetricCard label="Failed" value={providerGroups.metrics.failed} tone="danger" />
        </div>
      ) : null}
      <DeviceHeartbeatsSection
        title="Handheld"
        description="Choose the Bob session currently controlled by the Whisplay device."
      />

      {/* Runs List */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-muted/50 h-20 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : !filteredRuns.length ? (
        <Card className="p-8">
          <h3 className="font-display text-lg font-semibold">
            {emptyState.title}
          </h3>
          {emptyState.subtitle ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {emptyState.subtitle}
            </p>
          ) : null}
        </Card>
      ) : provider !== "all" ? (
        <div className="flex flex-col gap-6">
          <ProviderRunSection
            title="Active Sessions"
            runs={providerGroups.active}
            empty="No active sessions for this provider."
            workspaceId={workspaceId}
          />
          <ProviderRunSection
            title="Failed Tasks"
            runs={providerGroups.failed}
            empty="No failed task runs for this provider."
            workspaceId={workspaceId}
          />
          <ProviderRunSection
            title="Completed Tasks"
            runs={providerGroups.completed}
            empty="No completed task runs for this provider."
            workspaceId={workspaceId}
          />
          {providerGroups.other.length > 0 ? (
            <ProviderRunSection
              title="Other History"
              runs={providerGroups.other}
              empty="No other provider history."
              workspaceId={workspaceId}
            />
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredRuns.map((run: any) => (
            <ProviderRunRow key={run.id} run={run} workspaceId={workspaceId} />
          ))}
        </div>
      )}
    </div>
  );
}
