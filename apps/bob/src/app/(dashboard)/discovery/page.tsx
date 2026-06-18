"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";
import { Badge } from "@gmacko/core/ui/badge";
import { Button } from "@gmacko/core/ui/button";
import { Card } from "@gmacko/core/ui/card";
import { toast } from "@gmacko/core/ui/toast";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { useTRPC } from "~/trpc/react";

export default function DiscoveryPage() {
  const trpc = useTRPC();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [forgeBannerDismissed, setForgeBannerDismissed] = useState(false);
  const [registeringPaths, setRegisteringPaths] = useState<Set<string>>(
    new Set(),
  );

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

  // Forge register handler
  async function handleForgeRegister(path: string) {
    setRegisteringPaths((prev) => new Set(prev).add(path));
    try {
      const res = await fetch("/api/v1/forge/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Registration failed (${res.status})`);
      }
      toast("Registered with ForgeGraph");
      void queryClient.invalidateQueries({
        queryKey: trpc.project.discovery.queryKey({
          workspaceId: currentWorkspace?.id ?? "",
        }),
      });
    } catch (err: any) {
      toast(err.message ?? "Registration failed");
    } finally {
      setRegisteringPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }

  const isLoading = wsLoading || discoveryLoading;

  // No workspace
  if (!wsLoading && (!workspaces || workspaces.length === 0)) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <Breadcrumbs items={[{ label: "Discovery" }]} className="mb-4" />
        <Card className="px-8 py-12 text-center">
          <h1 className="font-display text-2xl font-bold text-foreground">
            No workspace found
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
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
          <h1 className="font-display text-3xl font-semibold text-foreground">
            Discovery
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Repositories and directories found on the daemon machine.
          </p>
        </div>
        {!isLoading && discovery && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{discovery.linked.length} active</span>
            <span className="text-border">|</span>
            <span>{discovery.gitOnly.length + discovery.forgeReady.length} discovered</span>
            <span className="text-border">|</span>
            <span>{discovery.nonGit.length} non-git</span>
          </div>
        )}
      </div>

      {/* Forge unavailable banner */}
      {discovery && !discovery.forgeAvailable && !forgeBannerDismissed && (
        <div className="mt-6 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm text-amber-300">
            ForgeGraph CLI not detected on daemon. Some features unavailable.
          </p>
          <button
            onClick={() => setForgeBannerDismissed(true)}
            className="ml-4 text-xs text-amber-400 hover:text-amber-200 transition-colors"
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
              className="animate-pulse rounded-2xl border border-border bg-card p-5"
            >
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="mt-3 h-5 w-2/3 rounded bg-muted" />
              <div className="mt-4 h-3 w-1/2 rounded bg-muted" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && (
        <Card className="mt-8 px-8 py-12 text-center">
          <p className="text-sm text-muted-foreground">
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
                <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Active Projects
                </h2>
                <span className="text-[10px] text-muted-foreground">
                  ({discovery.linked.length})
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {discovery.linked.map((repo: any) => (
                  <Card key={repo.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-medium text-foreground">
                            {repo.project?.name ?? repo.name}
                          </h3>
                          <Badge variant="emerald">linked</Badge>
                        </div>
                        <p className="mt-1 truncate text-xs font-mono text-muted-foreground">
                          {repo.path}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded border border-border px-1.5 py-0.5 font-mono">
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
                <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Discovered Repos
                </h2>
                <span className="text-[10px] text-muted-foreground">
                  ({discovery.gitOnly.length + discovery.forgeReady.length})
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[...discovery.forgeReady, ...discovery.gitOnly].map(
                  (repo: any) => (
                    <Card key={repo.id} className="p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-medium text-foreground">
                            {repo.remoteOwner && repo.remoteName
                              ? `${repo.remoteOwner}/${repo.remoteName}`
                              : repo.name}
                          </h3>
                          {repo.buildSystem && (
                            <Badge variant="blue">{repo.buildSystem}</Badge>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs font-mono text-muted-foreground">
                          {repo.path}
                        </p>
                        {repo.remoteUrl && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {repo.remoteUrl}
                          </p>
                        )}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <span className="rounded border border-border px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                          {repo.branch}
                        </span>
                        <div className="flex-1" />
                        {discovery.forgeAvailable && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={registeringPaths.has(repo.path)}
                            onClick={() => handleForgeRegister(repo.path)}
                          >
                            {registeringPaths.has(repo.path)
                              ? "Registering..."
                              : "Register"}
                          </Button>
                        )}
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
                <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Non-Git Directories
                </h2>
                <span className="text-[10px] text-muted-foreground">
                  ({discovery.nonGit.length})
                </span>
              </div>
              <div className="space-y-2">
                {discovery.nonGit.map((dir: any) => (
                  <div
                    key={dir.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <div className="min-w-0">
                      <span className="text-sm text-foreground">
                        {dir.name}
                      </span>
                      <span className="ml-2 truncate text-xs font-mono text-muted-foreground">
                        {dir.path}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={dismissDir.isPending}
                      onClick={() => dismissDir.mutate({ dirId: dir.id })}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
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
                <h2 className="font-display text-lg font-semibold text-foreground">
                  No repositories discovered
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
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
