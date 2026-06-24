"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PlusIcon } from "@radix-ui/react-icons";

import { Button } from "@gmacko/core/ui/button";
import { toast } from "@gmacko/core/ui/toast";

import {
  getPlanningShellActions,
  getPlanningProjectQueryRefreshOptions,
  getPlanningShellTitle,
  matchPlanningShellRoute,
} from "~/components/planning/planning-shell-model";
import {
  selectDefaultPlanningProject,
  type PlanningProjectOption,
} from "~/components/planning/planning-dashboard-model";
import { StartPlanningButton } from "~/components/planning/start-planning-button";
import { WorkspaceSelector } from "~/components/planning/workspace-selector";
import { CreateProjectDialog } from "~/components/projects/create-project-dialog";
import { ImportGitHubDialog } from "~/components/projects/import-github-dialog";
import { useBobRpcClient } from "~/rpc/react";

type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
};

export default function PlanningLayout({ children }: { children: React.ReactNode }) {
  const rpc = useBobRpcClient();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const activeRoute = matchPlanningShellRoute(pathname);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const {
    data: workspaceRows,
    isLoading: wsLoading,
  } = useQuery({
    queryKey: ["rpc", "planning.listWorkspaces"],
    queryFn: () => rpc.planning.listWorkspaces() as Promise<WorkspaceSummary[]>,
    staleTime: 60_000,
  });
  const workspaces = (workspaceRows ?? []) as WorkspaceSummary[];

  const workspaceParam = searchParams?.get("workspace") ?? null;
  const currentWorkspace =
    (workspaceParam
      ? workspaces?.find((w) => w.id === workspaceParam)
      : workspaces?.[0]) ?? null;

  const queryClient = useQueryClient();
  const createWorkspaceRpc = rpc.projects.workspace.create as (input: {
    name: string;
    slug: string;
  }) => Promise<unknown>;
  const {
    data: planningProjects,
    isLoading: planningProjectsLoading,
  } = useQuery({
    queryKey: [
      "rpc",
      "planning.listProjects",
      { workspaceId: currentWorkspace?.id ?? "" },
    ],
    queryFn: () =>
      rpc.planning.listProjects({
        workspaceId: currentWorkspace?.id ?? "",
      }) as Promise<PlanningProjectOption[]>,
    enabled: Boolean(currentWorkspace?.id),
    ...getPlanningProjectQueryRefreshOptions(),
  });
  const createWorkspace = useMutation({
    mutationFn: createWorkspaceRpc,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["rpc", "planning.listWorkspaces"],
      });
      toast("Workspace created!");
    },
    onError: (err: Error) => toast(err.message),
  });
  const [wsName, setWsName] = useState("");

  // Show setup screen when no workspace exists on routes managed by this shell.
  if (!wsLoading && (!workspaces || workspaces.length === 0) && activeRoute !== null) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
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

  const { heading, subtitle } = getPlanningShellTitle(activeRoute ?? "/planning");
  const shellActions = activeRoute ? getPlanningShellActions(activeRoute) : [];
  const defaultProject = selectDefaultPlanningProject(
    (planningProjects ?? []) as unknown as PlanningProjectOption[],
  );

  // For dispatch/review sub-routes, just render children without tabs
  if (activeRoute === null) {
    return <>{children}</>;
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight leading-[1.15] text-foreground">
            {heading}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {shellActions.length > 0 && (
          <div className="flex items-center gap-2">
            {shellActions.map((action) => {
              if (action.key === "start-planning-session") {
                return currentWorkspace && defaultProject ? (
                  <StartPlanningButton
                    key={action.key}
                    workspaceId={currentWorkspace.id}
                    projectId={defaultProject.id}
                    projectName={defaultProject.name}
                    label={action.label}
                    openTarget="route"
                  />
                ) : (
                  <Button
                    key={action.key}
                    variant="outline"
                    size="sm"
                    disabled
                    title={
                      planningProjectsLoading
                        ? "Loading projects..."
                        : "Create or import a project before starting a planning session."
                    }
                  >
                    <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
                    {action.label}
                  </Button>
                );
              }

              if (action.key === "import-github-project") {
                return (
                  <Button key={action.key} variant="outline" onClick={() => setImportOpen(true)}>
                    {action.label}
                  </Button>
                );
              }

              return (
                <Button key={action.key} onClick={() => setCreateOpen(true)}>
                  <PlusIcon className="mr-1.5 h-4 w-4" />
                  {action.label}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {activeRoute === "/planning/projects" && workspaces && workspaces.length > 1 && (
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
