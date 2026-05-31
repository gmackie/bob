"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  BoxIcon,
  CheckIcon,
  DesktopIcon,
  PlayIcon,
  PlusIcon,
  RocketIcon,
} from "@radix-ui/react-icons";
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

type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  lastHeartbeat: string | null;
};

function createSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isNodeOnline(lastHeartbeat: string | null): boolean {
  if (!lastHeartbeat) return false;
  return Date.now() - new Date(lastHeartbeat).getTime() < 5 * 60 * 1000;
}

function GettingStartedWizard({
  workspace,
  hasProject,
  hasOnlineNode,
  wsName,
  onWsNameChange,
  onCreateWorkspace,
  isCreatingWorkspace,
  onCreateProject,
  onImportProject,
}: {
  workspace: WorkspaceSummary | null;
  hasProject: boolean;
  hasOnlineNode: boolean;
  wsName: string;
  onWsNameChange: (name: string) => void;
  onCreateWorkspace: () => void;
  isCreatingWorkspace: boolean;
  onCreateProject: () => void;
  onImportProject: () => void;
}) {
  const steps = [
    {
      label: "Create workspace",
      description: workspace
        ? `${workspace.name || workspace.slug} is ready.`
        : "Name the workspace that will own your apps and nodes.",
      complete: Boolean(workspace),
      icon: BoxIcon,
      action: workspace ? null : (
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <input
            value={wsName}
            onChange={(e) => onWsNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && wsName.trim()) {
                onCreateWorkspace();
              }
            }}
            placeholder="Workspace name"
            className="border-border bg-background focus:ring-primary/50 min-w-0 flex-1 rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
          <Button
            onClick={onCreateWorkspace}
            disabled={!wsName.trim() || isCreatingWorkspace}
          >
            {isCreatingWorkspace ? "Creating..." : "Create"}
          </Button>
        </div>
      ),
    },
    {
      label: "Register first node",
      description: hasOnlineNode
        ? "A node is online and ready to run agents."
        : "Run the daemon setup on the machine that will execute work.",
      complete: hasOnlineNode,
      icon: DesktopIcon,
      action: workspace ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <code className="border-border bg-muted text-foreground rounded-md border px-3 py-2 font-mono text-xs">
            bob init
          </code>
          <Button variant="outline" asChild>
            <Link href="/nodes">View nodes</Link>
          </Button>
        </div>
      ) : null,
    },
    {
      label: "Create first app",
      description: hasProject
        ? "Your first app is linked as a project."
        : "Import a GitHub repo or create a ForgeGraph app-backed project.",
      complete: hasProject,
      icon: RocketIcon,
      action: workspace ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onImportProject}>Import from GitHub</Button>
          <Button variant="outline" onClick={onCreateProject}>
            Create manually
          </Button>
        </div>
      ) : null,
    },
    {
      label: "Trigger first deploy",
      description: hasProject
        ? "Start from a project work item, merge the first PR, and ForgeGraph will begin the deployment pipeline."
        : "This unlocks after the first app exists.",
      complete: false,
      icon: PlayIcon,
      action: hasProject ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/pull-requests">Open pull requests</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/runs">Watch runs</Link>
          </Button>
        </div>
      ) : null,
    },
  ];

  const completedCount = steps.filter((step) => step.complete).length;
  const activeIndex = steps.findIndex((step) => !step.complete);
  const progress = (completedCount / steps.length) * 100;

  return (
    <section className="border-border bg-card rounded-lg border">
      <div className="border-border border-b px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-primary text-xs font-semibold tracking-wider uppercase">
              Getting started
            </p>
            <h2 className="font-display text-foreground mt-1 text-xl font-semibold">
              Ship your first ForgeGraph app
            </h2>
          </div>
          <div className="text-muted-foreground text-sm">
            {completedCount} of {steps.length} complete
          </div>
        </div>
        <div className="bg-muted mt-4 h-2 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="divide-border divide-y">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = index === activeIndex;

          return (
            <div
              key={step.label}
              className={cn(
                "grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center",
                isActive && "bg-primary/5",
              )}
            >
              <div className="flex min-w-0 gap-3">
                <div
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
                    step.complete
                      ? "border-primary bg-primary text-primary-foreground"
                      : isActive
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground",
                  )}
                >
                  {step.complete ? (
                    <CheckIcon className="size-4" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-foreground text-base font-semibold">
                    {step.label}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {step.description}
                  </p>
                </div>
              </div>
              {isActive && step.action && (
                <div className="md:max-w-sm md:min-w-[280px]">
                  {step.action}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

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
      lastHeartbeat: (w.lastHeartbeat as string | null) ?? null,
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
  const hasOnlineNode = workspaces.some((workspace) =>
    isNodeOnline(workspace.lastHeartbeat),
  );
  const hasProject = projectCards.length > 0;

  function handleCreateWorkspace() {
    if (!wsName.trim()) return;

    createWorkspace.mutate({
      name: wsName.trim(),
      slug: createSlug(wsName),
    });
  }

  // No workspace state
  if (!wsLoading && (!workspaces || workspaces.length === 0)) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <Breadcrumbs items={[{ label: "Projects" }]} className="mb-4" />
        <GettingStartedWizard
          workspace={null}
          hasProject={false}
          hasOnlineNode={false}
          wsName={wsName}
          onWsNameChange={setWsName}
          onCreateWorkspace={handleCreateWorkspace}
          isCreatingWorkspace={createWorkspace.isPending}
          onCreateProject={() => setCreateOpen(true)}
          onImportProject={() => setImportOpen(true)}
        />
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

      {view === "projects" &&
        !isLoading &&
        (!hasProject || !hasOnlineNode || projectCards.length === 1) && (
          <div className="mt-8">
            <GettingStartedWizard
              workspace={currentWorkspace}
              hasProject={hasProject}
              hasOnlineNode={hasOnlineNode}
              wsName={wsName}
              onWsNameChange={setWsName}
              onCreateWorkspace={handleCreateWorkspace}
              isCreatingWorkspace={createWorkspace.isPending}
              onCreateProject={() => setCreateOpen(true)}
              onImportProject={() => setImportOpen(true)}
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
