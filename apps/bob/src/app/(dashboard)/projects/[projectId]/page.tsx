import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@gmacko/core/ui/badge";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { NewIdeaButton } from "~/components/planning/new-idea-button";
import { CreateWorkItemButton } from "~/components/work-items/create-work-item-button";
import { ProjectDetailTabs } from "~/components/projects/project-detail-tabs";
import {
  buildProjectConfigurationSections,
  buildProjectStatusRows,
  type ProjectConfigurationSection,
  type ProjectConfigurationSectionStatus,
  type ProjectStatusRow,
} from "~/components/projects/project-status-model";
import { ProjectTemplatePanel } from "~/components/projects/project-template-panel";
import {
  getProjectConfigurationHref,
  getProjectsDashboardHref,
  normalizeProjectDetailTab,
} from "~/components/projects/project-detail-tabs-model";
import { STATUS_COLOR, formatLabel } from "~/lib/design/colors";
import { createPlanningCaller } from "~/lib/planning/server";

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
}

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const { projectId } = await params;
  const resolvedSearchParams = await searchParams;
  const tabParam = Array.isArray(resolvedSearchParams?.tab)
    ? resolvedSearchParams?.tab[0]
    : resolvedSearchParams?.tab;
  const initialTab = normalizeProjectDetailTab(tabParam ?? null);
  const caller = (await createPlanningCaller()) as any;
  const projectResult = await caller.project.get({ id: projectId });

  if (!projectResult) {
    notFound();
  }

  const { project, counts, capabilities, linkedRepository, workspace } = projectResult;
  const [configurationRow] = buildProjectStatusRows({
    workspaceName: workspace?.name,
    projects: [projectResult],
  });
  const workItems = await caller.workItems.list({
    workspaceId: project.workspaceId,
    projectId: project.id,
    limit: 100,
  });

  // Find a top-level epic for the requirements tab
  const topEpic = workItems.find(
    (item: any) => item.kind === "epic" && !item.parentId,
  );

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Breadcrumbs
        items={[
          { label: "Projects", href: getProjectsDashboardHref(project.workspaceId) },
          { label: project.name },
        ]}
        className="mb-4"
      />

      {/* Header */}
      <section className="mt-4 rounded-[2rem] border border-border bg-gradient-to-br from-[#151f33] via-[#111827] to-[#101522] px-8 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-4xl font-bold tracking-tight leading-[1.15] text-white">
                {project.name}
              </h1>
              <span className="rounded-full border border-border bg-accent px-2.5 py-0.5 font-mono text-xs font-medium text-muted-foreground">
                {project.key}
              </span>
              {capabilities.template ? (
                <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-100">
                  Gmacko app
                </span>
              ) : null}
              <Badge
                variant={STATUS_COLOR[project.status] ?? "default"}
                className="text-[10px] px-1.5 py-0"
              >
                {formatLabel(project.status)}
              </Badge>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/60">
              {project.description?.trim() || "No project description yet."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <CreateWorkItemButton projectId={project.id} />
            <NewIdeaButton
              workspaceId={project.workspaceId}
              projectId={project.id}
            />
            <div
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: project.color ?? "#6b7280" }}
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span>{counts.issues} issues</span>
          <span>{counts.tasks} tasks</span>
          <span>{counts.epics} epics</span>
          <span>{counts.active} active</span>
        </div>
      </section>

      {configurationRow ? (
        <ProjectConfigurationSummary row={configurationRow} />
      ) : null}

      {capabilities.template ? (
        <section className="mt-10">
          <ProjectTemplatePanel
            linkedRepository={linkedRepository}
            capability={capabilities.template}
            planningAction={
              <NewIdeaButton
                workspaceId={project.workspaceId}
                projectId={project.id}
              />
            }
          />
        </section>
      ) : null}

      {/* Tabbed work items section */}
      <section className="mt-10">
        <ProjectDetailTabs
          items={workItems.map((item: any) => ({
            id: item.id,
            identifier: item.identifier,
            title: item.title,
            status: item.status,
            kind: item.kind,
            priority: item.priority ?? "no_priority",
            updatedAt: item.updatedAt ?? null,
          }))}
          epicWorkItemId={topEpic?.id}
          epicWorkItemKind={topEpic?.kind}
          projectId={project.id}
          automationSettings={project.automationSettings ?? undefined}
          defaultAgentType={project.defaultAgentType ?? null}
          configurationSections={
            configurationRow
              ? buildProjectConfigurationSections(configurationRow)
              : []
          }
          initialTab={initialTab}
          workspaceId={project.workspaceId}
        />
      </section>
    </main>
  );
}

function ProjectConfigurationSummary({ row }: { row: ProjectStatusRow }) {
  const configurationSections = buildProjectConfigurationSections(row);

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-foreground">
            Configuration
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Repository, branch, Linear, and Bob setup state for this project.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
            {row.warnings.length > 0 ? `${row.warnings.length} warning${row.warnings.length === 1 ? "" : "s"}` : "Ready"}
          </span>
          <Link
            href={getProjectConfigurationHref(row.id, row.workspaceId)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Manage
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ConfigField label="Directory" value={row.directory} />
        <ConfigField label="Repository" value={row.repository} />
        <ConfigField label="Branch" value={row.branchLabel} />
        <ConfigField label="Build" value={row.buildSystem} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ConfigBadge tone={row.gitStatus === "Clean" ? "good" : "warn"}>
          {row.gitStatus}
        </ConfigBadge>
        <ConfigBadge tone={row.linearStatus === "Connected" ? "good" : "warn"}>
          {row.linearStatus}
        </ConfigBadge>
        <ConfigBadge tone={row.configStatus === "Configured" ? "good" : "warn"}>
          {row.configStatus}
        </ConfigBadge>
      </div>

      {row.warnings.length > 0 ? (
        <p className="mt-4 text-sm text-amber-500">
          {row.warnings.join(", ")}
        </p>
      ) : null}

      <div className="mt-6 border-t border-border pt-5">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">
            Bob Configuration
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Assignment, mappings, defaults, execution, secrets, and validation state.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {configurationSections.map((section) => (
            <ConfigurationSectionCard key={section.key} section={section} />
          ))}
        </div>
      </div>
    </section>
  );
}

const SECTION_STATUS_CLASS: Record<ProjectConfigurationSectionStatus, string> = {
  ready: "border-emerald-500/25 bg-emerald-500/10 text-emerald-500",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-500",
  missing: "border-rose-500/25 bg-rose-500/10 text-rose-500",
};

function ConfigurationSectionCard({
  section,
}: {
  section: ProjectConfigurationSection;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="truncate text-sm font-semibold text-foreground">
          {section.title}
        </h4>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${SECTION_STATUS_CLASS[section.status]}`}>
          {section.status}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {section.items.map((item) => (
          <div key={`${section.key}-${item.label}`} className="min-w-0">
            <div className="text-[10px] uppercase text-muted-foreground">
              {item.label}
            </div>
            <div className="mt-0.5 truncate text-xs font-medium text-foreground" title={item.value}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-background/40 px-3 py-2">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

function ConfigBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "good" | "warn";
}) {
  return (
    <span
      className={
        tone === "good"
          ? "rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-500"
          : "rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-500"
      }
    >
      {children}
    </span>
  );
}
