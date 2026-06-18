"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ProjectCard } from "~/components/projects/project-card";
import { useTRPC } from "~/trpc/react";

export default function PlanningProjectsPage() {
  const trpc = useTRPC();
  const searchParams = useSearchParams();

  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );

  const workspaces = (workspaceMemberships ?? [])
    .map((m: any) => m.workspace)
    .filter(Boolean);

  const workspaceParam = searchParams?.get("workspace") ?? null;
  const currentWorkspace =
    (workspaceParam
      ? workspaces?.find((w: any) => w.id === workspaceParam)
      : workspaces?.[0]) ?? null;

  const { data: projectsData, isLoading } = useQuery(
    trpc.project.list.queryOptions(
      { workspaceId: currentWorkspace?.id ?? "" },
      { enabled: !!currentWorkspace, staleTime: 15_000 },
    ),
  );

  const projectCards = (projectsData ?? []).map((p: any) => ({
    id: p.project.id,
    label: p.project.key,
    name: p.project.name,
    color: p.project.color,
    status: p.project.status,
    totals: `${p.counts?.issues ?? 0} issues`,
    activeLabel: `${p.counts?.active ?? 0} active`,
  }));

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse rounded-2xl border border-border bg-card p-5">
            <div className="h-3 w-16 rounded bg-muted" />
            <div className="mt-3 h-5 w-3/4 rounded bg-muted" />
            <div className="mt-6 h-4 w-1/2 rounded bg-muted" />
            <div className="mt-3 h-3 w-2/3 rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (projectCards.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-8 py-12 text-center">
        <h2 className="mt-4 font-display text-lg font-semibold text-foreground">No projects yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">Create your first project to start organizing work.</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {projectCards.length} project{projectCards.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {projectCards.map((project) => (
          <ProjectCard key={project.id} {...project} />
        ))}
      </div>
    </>
  );
}
