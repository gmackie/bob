"use client";

import Link from "next/link";
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
    workspaceId: string | null;
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
          {onlineCount} online &middot; {workspaces.length} total
        </div>
      </div>

      {workspaces.length === 0 ? (
        <Card className="mt-8 p-8 text-center">
          <p className="text-sm font-medium text-foreground">No nodes registered</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run <code className="font-mono">bob init</code> on a machine to register it as a node.
          </p>
        </Card>
      ) : (
        <div className="mt-8 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-accent/30 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Node</th>
                <th className="px-4 py-3">Workspace</th>
                <th className="px-4 py-3 text-right">Agents</th>
                <th className="px-4 py-3 text-right">Repos</th>
                <th className="px-4 py-3 text-right">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {workspaces.map((ws: any) => {
                const online = isNodeOnline(ws.lastHeartbeat);
                const machineId = ws.machineId || ws.slug;
                const agentCount = ws.agentConfigs
                  ? Object.keys(ws.agentConfigs).length
                  : 0;
                const repoCount = repos.filter(
                  (r) => r.workspaceId === ws.id,
                ).length;

                return (
                  <tr key={ws.id} className="group transition-colors hover:bg-accent/20">
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-block size-2.5 rounded-full",
                        online ? "bg-emerald-500" : "bg-neutral-400",
                      )} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/nodes/${encodeURIComponent(machineId)}`}
                        className="font-display font-semibold text-foreground transition-colors hover:text-primary"
                      >
                        {machineId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {ws.slug}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {agentCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {repoCount}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {formatRelative(ws.lastHeartbeat)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
