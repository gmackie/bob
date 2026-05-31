import React from "react";
import { notFound } from "next/navigation";

import { Badge } from "@bob/ui/badge";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { NewIdeaButton } from "~/components/planning/new-idea-button";
import { ProjectDetailTabs } from "~/components/projects/project-detail-tabs";
import { ProjectTemplatePanel } from "~/components/projects/project-template-panel";
import { CreateWorkItemButton } from "~/components/work-items/create-work-item-button";
import { formatLabel, STATUS_COLOR } from "~/lib/design/colors";
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

  const { project, counts, capabilities, linkedRepository } = projectResult;
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
      <section className="border-border mt-4 rounded-[2rem] border bg-gradient-to-br from-[#151f33] via-[#111827] to-[#101522] px-8 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-4xl leading-[1.15] font-bold tracking-tight text-white">
                {project.name}
              </h1>
              <span className="border-border bg-accent text-muted-foreground rounded-full border px-2.5 py-0.5 font-mono text-xs font-medium">
                {project.key}
              </span>
              {capabilities.template ? (
                <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-100">
                  Gmacko app
                </span>
              ) : null}
              <Badge
                variant={STATUS_COLOR[project.status] ?? "default"}
                className="px-1.5 py-0 text-[10px]"
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

        <div className="text-muted-foreground mt-6 flex flex-wrap gap-3 text-sm">
          <span>{counts.issues} issues</span>
          <span>{counts.tasks} tasks</span>
          <span>{counts.epics} epics</span>
          <span>{counts.active} active</span>
        </div>
      </section>

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
            description: item.description ?? null,
            status: item.status,
            kind: item.kind,
            priority: item.priority ?? "no_priority",
            parentId: item.parentId ?? null,
            updatedAt: item.updatedAt ?? null,
          }))}
          defaultRequirementsWorkItemId={topEpic?.id}
          projectId={project.id}
          automationSettings={project.automationSettings ?? undefined}
        />
      </section>
    </main>
  );
}
