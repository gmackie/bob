"use client";

import { useQuery } from "@tanstack/react-query";

import { cn } from "@bob/ui";
import { Card } from "@bob/ui/card";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { useTRPC } from "~/trpc/react";

function isNodeOnline(lastHeartbeat: string | null): boolean {
  if (!lastHeartbeat) return false;
  return Date.now() - new Date(lastHeartbeat).getTime() < 5 * 60 * 1000;
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export default function NodesPage() {
  const trpc = useTRPC();

  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 10_000, refetchInterval: 15_000 }),
  );

  const workspaces = (workspaceMemberships ?? [])
    .map((m: any) => m.workspace)
    .filter(Boolean);

  const { data: repoData } = useQuery(
    trpc.repository.list.queryOptions(undefined, { staleTime: 30_000 }),
  );

  const repos = (repoData ?? []) as Array<{
    id: string;
    name: string;
    path: string;
    branch: string;
    mainBranch: string;
    remoteUrl: string | null;
    remoteOwner: string | null;
    remoteName: string | null;
    planningProjectId: string | null;
  }>;

  const onlineCount = workspaces.filter((w: any) => isNodeOnline(w.lastHeartbeat)).length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Breadcrumbs items={[{ label: "Nodes" }]} className="mb-4" />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-foreground">
            Nodes
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Machines running the bob daemon. Manage workspaces, repos, and agent capacity.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className={cn(
            "size-2 rounded-full",
            onlineCount > 0 ? "bg-emerald-500" : "bg-neutral-400",
          )} />
          {onlineCount} online · {workspaces.length} total
        </div>
      </div>

      {/* Nodes Grid */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {workspaces.length === 0 ? (
          <Card className="col-span-full p-8 text-center">
            <p className="text-sm font-medium text-foreground">No nodes registered</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Run <code className="font-mono">bob init</code> on a machine to register it as a node.
            </p>
          </Card>
        ) : (
          workspaces.map((ws: any) => {
            const online = isNodeOnline(ws.lastHeartbeat);
            const nodeRepos = repos.filter(
              (r) => r.planningProjectId && workspaces.some((w: any) => w.id === ws.id),
            );

            return (
              <Card key={ws.id} className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "size-2.5 rounded-full",
                      online ? "bg-emerald-500" : "bg-neutral-400",
                    )} />
                    <div>
                      <h3 className="font-display text-sm font-semibold text-foreground">
                        {ws.machineId || ws.name || ws.slug}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {online ? "Online" : "Offline"} · {formatRelative(ws.lastHeartbeat)}
                      </p>
                    </div>
                  </div>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    online
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-neutral-500/10 text-neutral-500",
                  )}>
                    {online ? "online" : "offline"}
                  </span>
                </div>

                {/* Node details */}
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-border bg-background p-3">
                    <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                      Workspace
                    </div>
                    <div className="mt-1 font-mono text-foreground">
                      {ws.name ?? ws.slug}
                    </div>
                    <div className="mt-0.5 font-mono text-muted-foreground text-[10px]">
                      {ws.id.slice(0, 8)}...
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3">
                    <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                      Agents
                    </div>
                    <div className="mt-1 text-foreground">
                      {ws.agentConfigs
                        ? Object.keys(ws.agentConfigs).join(", ") || "none"
                        : "not configured"}
                    </div>
                  </div>
                </div>

                {/* Repos on this node */}
                {nodeRepos.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground mb-1.5">
                      Repositories
                    </div>
                    <div className="space-y-1">
                      {nodeRepos.map((repo) => (
                        <div
                          key={repo.id}
                          className="flex items-center justify-between rounded-md bg-accent/50 px-2.5 py-1.5 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-foreground truncate">
                              {repo.remoteOwner && repo.remoteName
                                ? `${repo.remoteOwner}/${repo.remoteName}`
                                : repo.name}
                            </span>
                          </div>
                          <span className="shrink-0 font-mono text-muted-foreground">
                            {repo.branch}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      {/* Repositories Section */}
      <div className="mt-10">
        <h2 className="font-display text-xl font-semibold text-foreground">
          Repositories
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          All registered repositories across nodes.
        </p>

        <div className="mt-4 space-y-2">
          {repos.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No repositories registered. Import a ForgeGraph project or run{" "}
                <code className="font-mono">bob init</code> in a git repo.
              </p>
            </Card>
          ) : (
            repos.map((repo) => (
              <Card key={repo.id} className="flex items-center justify-between p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {repo.remoteOwner && repo.remoteName
                        ? `${repo.remoteOwner}/${repo.remoteName}`
                        : repo.name}
                    </span>
                    {repo.remoteUrl && (
                      <a
                        href={repo.remoteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {repo.path} · branch: {repo.branch}
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                  {repo.mainBranch}
                </span>
              </Card>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
