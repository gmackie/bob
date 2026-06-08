"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type React from "react";

import { cn } from "@gmacko/core/ui";

import {
  buildProjectStatusRows,
  filterProjectStatusRows,
  getProjectStatusDashboardColumns,
  getProjectStatusRowHref,
  normalizeProjectStatusFilter,
  type ProjectStatusEntry,
  type ProjectStatusRow,
} from "~/components/projects/project-status-model";
import { getPlanningProjectQueryRefreshOptions } from "~/components/planning/planning-shell-model";
import { useTRPC } from "~/trpc/react";

type WorkspaceMembership = {
  workspace?: {
    id: string;
    name: string;
    slug: string;
  } | null;
};

type WorkspaceSummary = NonNullable<WorkspaceMembership["workspace"]>;

const PROJECT_STATUS_GRID_CLASS =
  "grid grid-cols-[minmax(180px,1.2fr)_minmax(140px,0.9fr)_minmax(160px,1fr)_minmax(150px,1fr)_minmax(150px,1fr)_88px_88px_96px_104px_minmax(160px,1fr)] gap-4";
const PROJECT_STATUS_COLUMNS = getProjectStatusDashboardColumns();

export default function PlanningProjectsPage() {
  const trpc = useTRPC();
  const searchParams = useSearchParams();

  const { data: workspaceMemberships } = useQuery(
    trpc.workspace.list.queryOptions(undefined, { staleTime: 60_000 }),
  );

  const workspaceRows = (Array.isArray(workspaceMemberships) ? workspaceMemberships : []) as WorkspaceMembership[];

  const workspaces = workspaceRows
    .map((m) => m.workspace)
    .filter((workspace): workspace is WorkspaceSummary => Boolean(workspace));

  const workspaceParam = searchParams?.get("workspace") ?? null;
  const currentWorkspace =
    (workspaceParam
      ? workspaces?.find((w) => w.id === workspaceParam)
      : workspaces?.[0]) ?? null;

  const { data: projectsData, isLoading } = useQuery(
    trpc.project.list.queryOptions(
      { workspaceId: currentWorkspace?.id ?? "" },
      {
        enabled: !!currentWorkspace,
        ...getPlanningProjectQueryRefreshOptions(),
      },
    ),
  );

  const projectEntries = (Array.isArray(projectsData) ? projectsData : []) as ProjectStatusEntry[];

  const projectRows = buildProjectStatusRows({
    workspaceName: currentWorkspace?.name,
    projects: projectEntries,
  });
  const statusFilter = normalizeProjectStatusFilter(searchParams?.get("filter"));
  const visibleProjectRows = filterProjectStatusRows(projectRows, statusFilter);

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

  if (projectRows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-8 py-12 text-center">
        <h2 className="mt-4 font-display text-lg font-semibold text-foreground">No projects yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">Create your first project to start organizing work.</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {visibleProjectRows.length} project{visibleProjectRows.length !== 1 ? "s" : ""}
          {statusFilter ? ` · ${formatProjectFilterLabel(statusFilter)}` : ""}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className={`${PROJECT_STATUS_GRID_CLASS} border-b border-border px-4 py-3 text-xs font-medium uppercase text-muted-foreground`}>
          {PROJECT_STATUS_COLUMNS.map((column) => (
            <span key={column.key}>{column.label}</span>
          ))}
        </div>
        <div className="divide-y divide-border">
          {visibleProjectRows.map((row) => (
            <ProjectStatusTableRow key={row.id} row={row} />
          ))}
          {visibleProjectRows.length === 0 ? (
            <div className="px-4 py-8 text-sm text-muted-foreground">
              No projects match this filter.
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function formatProjectFilterLabel(filter: string): string {
  switch (filter) {
    case "setup-issues":
      return "setup issues";
    case "stale-sync":
      return "stale sync";
    case "healthy":
      return "healthy";
    default:
      return filter;
  }
}

function ProjectStatusTableRow({ row }: { row: ProjectStatusRow }) {
  return (
    <Link
      href={getProjectStatusRowHref(row.id, row.workspaceId)}
      className={`${PROJECT_STATUS_GRID_CLASS} px-4 py-3 text-sm transition hover:bg-secondary/60`}
    >
      <div className="min-w-0">
        <div className="font-medium text-foreground">{row.name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{row.key}</span>
          <span>{row.projectStatus}</span>
        </div>
      </div>
      <CellText>{row.workspaceName}</CellText>
      <CellText>{row.directory}</CellText>
      <CellText>{row.repository}</CellText>
      <CellText>{row.branchLabel}</CellText>
      <CellText>{row.buildSystem}</CellText>
      <StatusBadge tone={row.gitStatus === "Clean" ? "good" : "warn"}>
        {row.gitStatus}
      </StatusBadge>
      <StatusBadge tone={row.linearStatus === "Connected" ? "good" : "warn"}>
        {row.linearStatus}
      </StatusBadge>
      <StatusBadge tone={row.configStatus === "Configured" ? "good" : "warn"}>
        {row.configStatus}
      </StatusBadge>
      <CellText>{row.warnings.length > 0 ? row.warnings.join(", ") : "Ready"}</CellText>
    </Link>
  );
}

function CellText({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 self-center truncate text-muted-foreground" title={String(children)}>
      {children}
    </div>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "good" | "warn";
}) {
  return (
    <span
      className={cn(
        "self-center justify-self-start rounded-full border px-2 py-1 text-xs font-medium",
        tone === "good"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-500"
          : "border-amber-500/25 bg-amber-500/10 text-amber-500",
      )}
    >
      {children}
    </span>
  );
}
