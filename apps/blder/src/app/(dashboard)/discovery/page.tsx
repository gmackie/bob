"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@bob/ui/badge";
import { Button } from "@bob/ui/button";
import { Card } from "@bob/ui/card";
import { toast } from "@bob/ui/toast";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { useTRPC } from "~/trpc/react";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export default function DiscoveryPage() {
  const trpc = useTRPC();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [forgeBannerDismissed, setForgeBannerDismissed] = useState(false);

  // Fetch workspaces
  const { data: workspaceMemberships, isLoading: wsLoading } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );

  const workspaces = (workspaceMemberships ?? [])
    .map((m: any) => m.workspace)
    .filter(Boolean)
    .map((w: any) => ({
      id: w.id as string,
      name: w.name as string,
      slug: w.slug as string,
    }));

  const workspaceParam = searchParams?.get("workspace") ?? null;
  const currentWorkspace =
    (workspaceParam
      ? workspaces?.find((w) => w.id === workspaceParam)
      : workspaces?.[0]) ?? null;

  // Fetch discovery data with 30s auto-refresh
  const {
    data: discovery,
    isLoading: discoveryLoading,
    isError,
  } = useQuery(
    trpc.project.discovery.queryOptions(
      { workspaceId: currentWorkspace?.id ?? "" },
      {
        enabled: !!currentWorkspace,
        staleTime: 15_000,
        refetchInterval: 30_000,
      },
    ),
  );

  // Dismiss directory mutation
  const dismissDir = useMutation(
    trpc.project.dismissDir.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.project.discovery.queryKey({
            workspaceId: currentWorkspace?.id ?? "",
          }),
        });
        toast("Directory dismissed");
      },
      onError: (err) => toast(err.message),
    }),
  );

  const isLoading = wsLoading || discoveryLoading;

  // No workspace
  if (!wsLoading && (!workspaces || workspaces.length === 0)) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <Breadcrumbs items={[{ label: "Discovery" }]} className="mb-4" />
        <Card className="px-8 py-12 text-center">
          <h1 className="font-display text-foreground text-2xl font-bold">
            No workspace found
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Create a workspace first to discover repositories.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Breadcrumbs items={[{ label: "Discovery" }]} className="mb-4" />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-foreground text-3xl font-semibold">
            Discovery
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Repositories and directories found on the daemon machine.
          </p>
        </div>
        {!isLoading && discovery && (
          <div className="text-muted-foreground flex items-center gap-3 text-sm">
            <span>{discovery.linked.length} active</span>
            <span className="text-border">|</span>
            <span>
              {discovery.gitOnly.length + discovery.forgeReady.length}{" "}
              discovered
            </span>
            <span className="text-border">|</span>
            <span>{discovery.nonGit.length} non-git</span>
          </div>
        )}
      </div>

      {/* Forge unavailable banner */}
      {discovery && !discovery.forgeAvailable && !forgeBannerDismissed && (
        <div className="mt-6 flex items-start justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-amber-200">
              ForgeGraph is not ready on the daemon machine.
            </p>
            <p className="mt-1 text-sm text-amber-300">
              Install or authenticate the ForgeGraph CLI, then restart the bob
              daemon. Run{" "}
              <code className="font-mono text-xs">fg auth login</code> if the
              CLI is already installed.
            </p>
          </div>
          <button
            onClick={() => setForgeBannerDismissed(true)}
            className="shrink-0 text-xs text-amber-400 transition-colors hover:text-amber-200"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="mt-8 space-y-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="border-border bg-card animate-pulse rounded-2xl border p-5"
            >
              <div className="bg-muted h-3 w-24 rounded" />
              <div className="bg-muted mt-3 h-5 w-2/3 rounded" />
              <div className="bg-muted mt-4 h-3 w-1/2 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && (
        <Card className="mt-8 px-8 py-12 text-center">
          <p className="text-muted-foreground text-sm">
            Failed to load discovery data. Check that the gateway is running.
          </p>
        </Card>
      )}

      {/* Discovery content */}
      {discovery && !isLoading && (
        <>
          {/* Active Projects */}
          {discovery.linked.length > 0 && (
            <section className="mt-8">
              <div className="mb-3 flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500" />
                <h2 className="text-muted-foreground text-[10px] font-medium tracking-widest uppercase">
                  Active Projects
                </h2>
                <span className="text-muted-foreground text-[10px]">
                  ({discovery.linked.length})
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {discovery.linked.map((repo: any) => (
                  <Card key={repo.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-foreground truncate text-sm font-medium">
                            {repo.project?.name ?? repo.name}
                          </h3>
                          <Badge variant="emerald">linked</Badge>
                        </div>
                        <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
                          {repo.path}
                        </p>
                      </div>
                    </div>
                    <div className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
                      <span className="border-border rounded border px-1.5 py-0.5 font-mono">
                        {repo.branch}
                      </span>
                      {repo.remoteUrl && (
                        <a
                          href={repo.remoteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          remote
                        </a>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Discovered Repos (git but not linked) */}
          {(discovery.gitOnly.length > 0 ||
            discovery.forgeReady.length > 0) && (
            <section className="mt-8">
              <div className="mb-3 flex items-center gap-2">
                <span className="size-2 rounded-full bg-amber-500" />
                <h2 className="text-muted-foreground text-[10px] font-medium tracking-widest uppercase">
                  Discovered Repos
                </h2>
                <span className="text-muted-foreground text-[10px]">
                  ({discovery.gitOnly.length + discovery.forgeReady.length})
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[...discovery.forgeReady, ...discovery.gitOnly].map(
                  (repo: any) => (
                    <Card key={repo.id} className="p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-foreground truncate text-sm font-medium">
                            {repo.remoteOwner && repo.remoteName
                              ? `${repo.remoteOwner}/${repo.remoteName}`
                              : repo.name}
                          </h3>
                          {repo.buildSystem && (
                            <Badge variant="blue">{repo.buildSystem}</Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
                          {repo.path}
                        </p>
                        {repo.remoteUrl && (
                          <p className="text-muted-foreground mt-0.5 truncate text-xs">
                            {repo.remoteUrl}
                          </p>
                        )}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <span className="border-border text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-xs">
                          {repo.branch}
                        </span>
                        <div className="flex-1" />
                        <Badge
                          variant={
                            discovery.forgeAvailable ? "blue" : "default"
                          }
                        >
                          {discovery.forgeAvailable
                            ? "CLI ready"
                            : "CLI unavailable"}
                        </Badge>
                      </div>
                      <div className="border-border bg-muted/30 mt-3 rounded-md border p-3">
                        <p className="text-muted-foreground text-xs">
                          {discovery.forgeAvailable
                            ? "Register this repo from the daemon machine. Bob links it after the next heartbeat."
                            : "Recover ForgeGraph on the daemon, then register this repo from that machine."}
                        </p>
                        <code className="text-foreground mt-2 block font-mono text-xs break-all">
                          fg app create --path {shellQuote(repo.path)}
                        </code>
                      </div>
                    </Card>
                  ),
                )}
              </div>
            </section>
          )}

          {/* Non-Git Directories */}
          {discovery.nonGit.length > 0 && (
            <section className="mt-8">
              <div className="mb-3 flex items-center gap-2">
                <span className="size-2 rounded-full bg-neutral-500" />
                <h2 className="text-muted-foreground text-[10px] font-medium tracking-widest uppercase">
                  Non-Git Directories
                </h2>
                <span className="text-muted-foreground text-[10px]">
                  ({discovery.nonGit.length})
                </span>
              </div>
              <div className="space-y-2">
                {discovery.nonGit.map((dir: any) => (
                  <div
                    key={dir.id}
                    className="border-border bg-card flex items-center justify-between rounded-lg border px-4 py-3"
                  >
                    <div className="min-w-0">
                      <span className="text-foreground text-sm">
                        {dir.name}
                      </span>
                      <span className="text-muted-foreground ml-2 truncate font-mono text-xs">
                        {dir.path}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={dismissDir.isPending}
                      onClick={() => dismissDir.mutate({ dirId: dir.id })}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                    >
                      Dismiss
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Empty state */}
          {discovery.linked.length === 0 &&
            discovery.gitOnly.length === 0 &&
            discovery.forgeReady.length === 0 &&
            discovery.nonGit.length === 0 && (
              <Card className="mt-8 px-8 py-12 text-center">
                <h2 className="font-display text-foreground text-lg font-semibold">
                  No repositories discovered
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  The daemon hasn't found any repositories yet. Make sure the
                  gateway is running and scanning your development directories.
                </p>
              </Card>
            )}
        </>
      )}
    </main>
  );
}
