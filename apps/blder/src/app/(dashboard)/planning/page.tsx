"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PlusIcon } from "@radix-ui/react-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";
import { toast } from "@bob/ui/toast";

import { MissionControl } from "~/components/dashboard/mission-control";
import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { WorkspaceSelector } from "~/components/planning/workspace-selector";
import { CreateProjectDialog } from "~/components/projects/create-project-dialog";
import { ImportGitHubDialog } from "~/components/projects/import-github-dialog";
import { ProjectCard } from "~/components/projects/project-card";
import { useTRPC } from "~/trpc/react";

type PlanningView = "dashboard" | "projects";

export default function PlanningPage() {
  const trpc = useTRPC();
  const searchParams = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Fetch workspaces (local DB, not remote planning API)
  const { data: workspaceMemberships, isLoading: wsLoading } = useQuery(
    trpc.workspace.list.queryOptions(undefined, {
      staleTime: 60_000,
    }),
  );

  // Map memberships to flat workspace objects
  const workspaces = (workspaceMemberships ?? [])
    .map((m: any) => m.workspace)
    .filter(Boolean)
    .map((w: any) => ({
      id: w.id as string,
      name: w.name as string,
      slug: w.slug as string,
    }));

  // Read workspace from URL param (set by WorkspaceSelector), default to first
  const workspaceParam = searchParams?.get("workspace") ?? null;

  const currentWorkspace =
    (workspaceParam
      ? workspaces?.find((w) => w.id === workspaceParam)
      : workspaces?.[0]) ?? null;

  // Fetch projects for the current workspace (local DB)
  const { data: projectsData, isLoading: projLoading } = useQuery(
    trpc.project.list.queryOptions(
      { workspaceId: currentWorkspace?.id ?? "" },
      {
        enabled: !!currentWorkspace,
        staleTime: 15_000,
      },
    ),
  );

  // Map projects to card props
  const projectCards = (projectsData ?? []).map((p: any) => ({
    id: p.project.id,
    label: p.project.key,
    name: p.project.name,
    color: p.project.color,
    status: p.project.status,
    totals: `${p.counts?.issues ?? 0} issues`,
    activeLabel: `${p.counts?.active ?? 0} active`,
  }));

  const isLoading = wsLoading || projLoading;

  // Check for active agents to determine default view
  const { data: instances } = useQuery(
    trpc.instance.list.queryOptions(undefined, { staleTime: 10_000 }),
  );
  const hasActiveAgents = (instances ?? []).some(
    (i: any) => i.status === "running" || i.status === "starting",
  );

  const [view, setView] = useState<PlanningView>(
    hasActiveAgents ? "dashboard" : "projects",
  );

  // Create workspace mutation
  const queryClient = useQueryClient();
  const createWorkspace = useMutation(
    trpc.workspace.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.workspace.list.queryKey(),
        });
        toast("Workspace created!");
      },
      onError: (err) => toast(err.message),
    }),
  );

  const [wsName, setWsName] = useState("");

  // No workspace state
  if (!wsLoading && (!workspaces || workspaces.length === 0)) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <Breadcrumbs items={[{ label: "Projects" }]} className="mb-4" />
        <div className="border-border bg-secondary rounded-2xl border px-8 py-12 text-center">
          <div className="text-4xl">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="text-muted-foreground mx-auto h-12 w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
          </div>
          <h1 className="font-display text-foreground mt-4 text-4xl leading-[1.15] font-bold tracking-tight">
            No workspace yet
          </h1>
          <p className="text-muted-foreground mt-3 text-sm">
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
                    slug: wsName
                      .trim()
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, ""),
                  });
                }
              }}
              placeholder="Workspace name"
              className="border-border bg-background focus:ring-primary/50 flex-1 rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <Button
              onClick={() => {
                if (wsName.trim()) {
                  createWorkspace.mutate({
                    name: wsName.trim(),
                    slug: wsName
                      .trim()
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, ""),
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

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Breadcrumbs items={[{ label: "Projects" }]} className="mb-4" />

      {/* View toggle + header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-1">
            {(["dashboard", "projects"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  view === v
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "dashboard" ? "Dashboard" : "Projects"}
              </button>
            ))}
          </div>
          <h1 className="font-display text-foreground text-4xl leading-[1.15] font-bold tracking-tight">
            {view === "dashboard" ? "Mission Control" : "Projects"}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {view === "dashboard"
              ? "Live overview of your agents and projects"
              : "Your workspaces and projects"}
          </p>
        </div>
        {view === "projects" && (
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

      {/* Dashboard view */}
      {view === "dashboard" && (
        <section className="mt-8">
          <MissionControl workspaceId={currentWorkspace?.id} />
        </section>
      )}

      {/* Workspace selector (projects view only) */}
      {view === "projects" && workspaces && workspaces.length > 1 && (
        <div className="mt-6">
          <WorkspaceSelector
            workspaces={workspaces.map((w) => ({
              id: w.id,
              name: w.name,
              slug: w.slug,
            }))}
            currentId={currentWorkspace?.id ?? ""}
          />
        </div>
      )}

      {/* Projects grid (projects view only) */}
      {view === "projects" && (
        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-muted-foreground text-sm">
              {isLoading
                ? ""
                : `${projectCards.length} project${projectCards.length !== 1 ? "s" : ""}`}
            </span>
          </div>

          {isLoading ? (
            /* Loading skeleton */
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="border-border bg-card animate-pulse rounded-2xl border p-5"
                >
                  <div className="bg-muted h-3 w-16 rounded" />
                  <div className="bg-muted mt-3 h-5 w-3/4 rounded" />
                  <div className="bg-muted mt-6 h-4 w-1/2 rounded" />
                  <div className="bg-muted mt-3 h-3 w-2/3 rounded" />
                </div>
              ))}
            </div>
          ) : projectCards.length === 0 ? (
            /* Empty state */
            <div className="border-border rounded-2xl border border-dashed px-8 py-12 text-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="text-muted-foreground mx-auto h-10 w-10"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                />
              </svg>
              <h2 className="font-display text-foreground mt-4 text-lg font-semibold">
                No projects yet
              </h2>
              <p className="text-muted-foreground mt-2 text-sm">
                Create your first project to start organizing work.
              </p>
              <Button className="mt-5" onClick={() => setCreateOpen(true)}>
                <PlusIcon className="mr-1.5 h-4 w-4" />
                Create your first project
              </Button>
            </div>
          ) : (
            /* Projects grid */
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {projectCards.map((project) => (
                <ProjectCard key={project.id} {...project} />
              ))}
            </div>
          )}

          {/* Getting started hint when few projects */}
          {!isLoading && projectCards.length > 0 && projectCards.length < 3 && (
            <div className="border-border mt-8 rounded-2xl border border-dashed px-8 py-6 text-center">
              <h3 className="font-display text-foreground text-lg font-semibold">
                Get started with BizPulse
              </h3>
              <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
                Import your GitHub repositories as projects, then use &ldquo;New
                Idea&rdquo; to start planning with Claude.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Create project dialog */}
      {currentWorkspace && (
        <CreateProjectDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          workspaceId={currentWorkspace.id}
        />
      )}

      {/* Import from GitHub dialog */}
      {currentWorkspace && (
        <ImportGitHubDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          workspaceId={currentWorkspace.id}
        />
      )}
    </main>
  );
}
