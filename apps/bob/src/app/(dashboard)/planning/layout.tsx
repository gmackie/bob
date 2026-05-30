"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PlusIcon } from "@radix-ui/react-icons";

import { cn } from "@gmacko/core/ui";
import { Button } from "@gmacko/core/ui/button";
import { toast } from "@gmacko/core/ui/toast";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { WorkspaceSelector } from "~/components/planning/workspace-selector";
import { CreateProjectDialog } from "~/components/projects/create-project-dialog";
import { ImportGitHubDialog } from "~/components/projects/import-github-dialog";
import { useTRPC } from "~/trpc/react";

const TABS = [
  { href: "/planning", label: "Dashboard" },
  { href: "/planning/projects", label: "Projects" },
  { href: "/planning/board", label: "Board" },
] as const;

function matchTab(pathname: string) {
  if (pathname === "/planning" || pathname === "/planning/") return "/planning";
  if (pathname.startsWith("/planning/projects")) return "/planning/projects";
  if (pathname.startsWith("/planning/board")) return "/planning/board";
  return null;
}

export default function PlanningLayout({ children }: { children: React.ReactNode }) {
  const trpc = useTRPC();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const activeTab = matchTab(pathname);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const {
    data: workspaceMemberships,
    isLoading: wsLoading,
  } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );

  const workspaces = (workspaceMemberships ?? [])
    .map((m: any) => m.workspace)
    .filter(Boolean)
    .map((w: any) => ({ id: w.id as string, name: w.name as string, slug: w.slug as string }));

  const workspaceParam = searchParams?.get("workspace") ?? null;
  const currentWorkspace =
    (workspaceParam
      ? workspaces?.find((w) => w.id === workspaceParam)
      : workspaces?.[0]) ?? null;

  const queryClient = useQueryClient();
  const createWorkspace = useMutation(
    trpc.workspace.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.workspace.list.queryKey() });
        toast("Workspace created!");
      },
      onError: (err) => toast(err.message),
    }),
  );
  const [wsName, setWsName] = useState("");

  // Show setup screen when no workspace exists — only on the main planning routes
  if (!wsLoading && (!workspaces || workspaces.length === 0) && activeTab !== null) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <Breadcrumbs items={[{ label: "Projects" }]} className="mb-4" />
        <div className="rounded-2xl border border-border bg-secondary px-8 py-12 text-center">
          <h1 className="mt-4 font-display text-4xl font-bold tracking-tight leading-[1.15] text-foreground">
            No workspace yet
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Create your first workspace to start planning.
          </p>
          <div className="mx-auto mt-6 flex max-w-sm items-center gap-2">
            <input
              value={wsName}
              onChange={(e) => setWsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && wsName.trim()) {
                  createWorkspace.mutate({
                    name: wsName.trim(),
                    slug: wsName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
                  });
                }
              }}
              placeholder="Workspace name"
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <Button
              onClick={() => {
                if (wsName.trim()) {
                  createWorkspace.mutate({
                    name: wsName.trim(),
                    slug: wsName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
                  });
                }
              }}
              disabled={!wsName.trim() || createWorkspace.isPending}
            >
              {createWorkspace.isPending ? "Creating..." : "Create Workspace"}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const titles: Record<string, { heading: string; subtitle: string }> = {
    "/planning": { heading: "Mission Control", subtitle: "Live overview of your agents and projects" },
    "/planning/projects": { heading: "Projects", subtitle: "Your workspaces and projects" },
    "/planning/board": { heading: "Board", subtitle: "Work items across all statuses" },
  };
  const { heading, subtitle } = titles[activeTab ?? ""] ?? titles["/planning"]!;

  // For dispatch/review sub-routes, just render children without tabs
  if (activeTab === null) {
    return <>{children}</>;
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Breadcrumbs items={[{ label: "Projects" }]} className="mb-4" />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-1 mb-2">
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={
                  currentWorkspace
                    ? `${tab.href}?workspace=${currentWorkspace.id}`
                    : tab.href
                }
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  activeTab === tab.href
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight leading-[1.15] text-foreground">
            {heading}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {activeTab === "/planning/projects" && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              Import from GitHub
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="mr-1.5 h-4 w-4" />
              Create Project
            </Button>
          </div>
        )}
      </div>

      {activeTab === "/planning/projects" && workspaces && workspaces.length > 1 && (
        <div className="mt-6">
          <WorkspaceSelector
            workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug }))}
            currentId={currentWorkspace?.id ?? ""}
          />
        </div>
      )}

      <section className="mt-8">{children}</section>

      {currentWorkspace && (
        <>
          <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} workspaceId={currentWorkspace.id} />
          <ImportGitHubDialog open={importOpen} onOpenChange={setImportOpen} workspaceId={currentWorkspace.id} />
        </>
      )}
    </main>
  );
}
