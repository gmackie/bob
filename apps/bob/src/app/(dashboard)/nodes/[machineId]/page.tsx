"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

function formatAbsolute(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

export default function NodeDetailPage({
  params,
}: {
  params: Promise<{ machineId: string }>;
}) {
  const { machineId } = use(params);
  const decodedMachineId = decodeURIComponent(machineId);
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");

  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 10_000, refetchInterval: 15_000 }),
  );

  const renameMutation = useMutation(
    trpc.workspace.rename.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.workspace.list.queryKey() });
        setEditing(false);
      },
    }),
  );

  const workspaces = (workspaceMemberships ?? [])
    .map((m: any) => m.workspace)
    .filter(Boolean);

  const workspace = workspaces.find(
    (ws: any) => (ws.machineId || ws.slug) === decodedMachineId,
  );

  const { data: repoData } = useQuery(
    trpc.repository.list.queryOptions(undefined, { staleTime: 30_000 }),
  );

  const allRepos = (repoData ?? []) as Array<{
    id: string;
    name: string;
    path: string;
    branch: string;
    mainBranch: string;
    remoteUrl: string | null;
    remoteOwner: string | null;
    remoteName: string | null;
    workspaceId: string | null;
    dirty: boolean | null;
    stale: boolean | null;
  }>;

  const nodeRepos = workspace
    ? allRepos.filter((r) => r.workspaceId === workspace.id)
    : [];

  const agents: Array<{ name: string; config: any }> = workspace?.agentConfigs
    ? Object.entries(workspace.agentConfigs).map(([name, config]) => ({
        name,
        config,
      }))
    : [];

  const online = workspace ? isNodeOnline(workspace.lastHeartbeat) : false;

  // Needs attention items
  const attentionItems: Array<{ label: string; type: "warning" | "error" }> = [];
  if (!online && workspace) {
    attentionItems.push({ label: "Node is offline", type: "error" });
  }
  for (const repo of nodeRepos) {
    if (repo.dirty) attentionItems.push({ label: `${repo.name} has uncommitted changes`, type: "warning" });
    if (repo.stale) attentionItems.push({ label: `${repo.name} is stale`, type: "warning" });
  }

  if (!workspace) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Breadcrumbs
          items={[
            { label: "Nodes", href: "/nodes" },
            { label: decodedMachineId },
          ]}
          className="mb-4"
        />
        <Card className="p-8 text-center">
          <p className="text-sm font-medium text-foreground">Node not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No node with machine ID &ldquo;{decodedMachineId}&rdquo; is registered.
          </p>
          <Link
            href="/nodes"
            className="mt-4 inline-block text-sm text-primary hover:underline"
          >
            Back to nodes
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Breadcrumbs
        items={[
          { label: "Nodes", href: "/nodes" },
          { label: decodedMachineId },
        ]}
        className="mb-4"
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
        {/* Left Panel — Status */}
        <div className="lg:sticky lg:top-10 lg:self-start">
          <div className="space-y-6">
            {/* Node header */}
            <div>
              <div className="flex items-center gap-3">
                {editing ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = draftName.trim();
                      if (!name || name === workspace.name) {
                        setEditing(false);
                        return;
                      }
                      renameMutation.mutate({ id: workspace.id, name });
                    }}
                  >
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => setEditing(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(false);
                      }}
                      className="w-48 rounded-md border border-border bg-background px-2 py-1 font-display text-2xl font-semibold text-foreground focus:border-primary focus:outline-none"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftName(workspace.name ?? decodedMachineId);
                      setEditing(true);
                    }}
                    className="group flex items-center gap-2 text-left"
                    title="Rename node"
                  >
                    <h1 className="font-display text-2xl font-semibold text-foreground group-hover:text-primary">
                      {workspace.name || decodedMachineId}
                    </h1>
                    <span className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      ✎
                    </span>
                  </button>
                )}
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[10px] font-medium",
                    online
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-neutral-500/10 text-neutral-500",
                  )}
                >
                  {online ? "online" : "offline"}
                </span>
              </div>
              <p
                className="mt-1 text-sm text-muted-foreground"
                title={formatAbsolute(workspace.lastHeartbeat)}
              >
                Last seen {formatRelative(workspace.lastHeartbeat)}
              </p>
            </div>

            {/* Workspace info */}
            <Card className="p-4 space-y-3">
              <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Workspace
              </h2>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium text-foreground">
                    {workspace.name ?? workspace.slug}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Slug</span>
                  <span className="font-mono text-foreground">{workspace.slug}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ID</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {workspace.id.slice(0, 8)}
                  </span>
                </div>
              </div>
            </Card>

            {/* Quick stats */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-4 text-center">
                <div className="text-2xl font-semibold text-foreground">
                  {agents.length}
                </div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Agents
                </div>
              </Card>
              <Card className="p-4 text-center">
                <div className="text-2xl font-semibold text-foreground">
                  {nodeRepos.length}
                </div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Repos
                </div>
              </Card>
            </div>

            {/* Needs attention */}
            {attentionItems.length > 0 && (
              <Card className="border-amber-500/30 bg-amber-500/5 p-4">
                <h2 className="text-[10px] font-medium uppercase tracking-widest text-amber-600 dark:text-amber-400">
                  Needs Attention
                </h2>
                <ul className="mt-2 space-y-1.5">
                  {attentionItems.map((item, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          item.type === "error"
                            ? "bg-red-500"
                            : "bg-amber-500",
                        )}
                      />
                      <span className="text-foreground">{item.label}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>

        {/* Right Panel — Detail */}
        <div className="space-y-8">
          {/* Agents Section */}
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">
              Agents
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Configured agent capacity on this node.
            </p>

            {agents.length === 0 ? (
              <Card className="mt-4 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No agents configured. Update <code className="font-mono">agentConfigs</code> in the workspace settings.
                </p>
              </Card>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {agents.map((agent) => (
                  <Card key={agent.name} className="p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-sm font-semibold text-foreground">
                        {agent.name}
                      </h3>
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        available
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {typeof agent.config === "object" && agent.config !== null
                        ? Object.entries(agent.config)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(", ") || "default config"
                        : "default config"}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Repositories Section */}
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">
              Repositories
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Repos registered on this node.
            </p>

            {nodeRepos.length === 0 ? (
              <Card className="mt-4 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No repositories linked to this node.
                </p>
              </Card>
            ) : (
              <div className="mt-4 overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-accent/30 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-3">Repository</th>
                      <th className="px-4 py-3">Branch</th>
                      <th className="px-4 py-3">Main</th>
                      <th className="px-4 py-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {nodeRepos.map((repo) => (
                      <tr key={repo.id} className="transition-colors hover:bg-accent/20">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">
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
                                &#x2197;
                              </a>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {repo.path}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">
                          {repo.branch}
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">
                          {repo.mainBranch}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {repo.dirty && (
                              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                dirty
                              </span>
                            )}
                            {repo.stale && (
                              <span className="rounded-full bg-neutral-500/10 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
                                stale
                              </span>
                            )}
                            {!repo.dirty && !repo.stale && (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                clean
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
