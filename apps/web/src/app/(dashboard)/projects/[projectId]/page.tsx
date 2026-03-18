import React from "react";
import { notFound } from "next/navigation";

import { Badge } from "@bob/ui/badge";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { RepositoryPanel } from "~/components/dashboard";
import { StartPlanningButton } from "~/components/planning/start-planning-button";
import { CreateWorkItemButton } from "~/components/work-items/create-work-item-button";
import { ProjectDetailTabs } from "~/components/projects/project-detail-tabs";
import { STATUS_COLOR, formatLabel } from "~/lib/design/colors";
import { createPlanningCaller } from "~/lib/planning/server";

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
}

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  const caller = (await createPlanningCaller()) as any;
  const projectResult = await caller.project.get({ id: projectId });

  if (!projectResult) {
    notFound();
  }

  const { project, counts } = projectResult;
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
          { label: "Projects", href: "/planning" },
          { label: project.name },
        ]}
        className="mb-4"
      />

      {/* Header */}
      <section className="mt-4 rounded-[2rem] border border-border bg-gradient-to-br from-[#151f33] via-[#111827] to-[#101522] px-8 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-bold text-foreground">
                {project.name}
              </h1>
              <span className="rounded-full border border-border bg-accent px-2.5 py-0.5 font-mono text-xs font-medium text-muted-foreground">
                {project.key}
              </span>
              <Badge
                variant={STATUS_COLOR[project.status] ?? "default"}
                className="text-[10px] px-1.5 py-0"
              >
                {formatLabel(project.status)}
              </Badge>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              {project.description?.trim() || "No project description yet."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <CreateWorkItemButton projectId={project.id} />
            <StartPlanningButton
              workspaceId={project.workspaceId}
              projectId={project.id}
              projectName={project.name}
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

      {/* Repository panel */}
      <section className="mt-10">
        <RepositoryPanel projectId={project.id} />
      </section>

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
        />
      </section>
    </main>
  );
}
