import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RepositoryPanel } from "~/components/dashboard";
import { WorkItemBoard } from "~/components/work-items/work-item-board";
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

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Link
        href="/planning"
        className="text-sm text-white/45 transition hover:text-white"
      >
        Back to planning
      </Link>

      <section className="mt-4 rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#151f33] via-[#111827] to-[#101522] px-8 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-white/35">
              {project.key}
            </div>
            <h1 className="mt-3 text-4xl font-semibold text-white">
              {project.name}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/62">
              {project.description?.trim() || "No project description yet."}
            </p>
          </div>
          <div
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: project.color ?? "#6b7280" }}
          />
        </div>

        <div className="mt-6 flex flex-wrap gap-3 text-sm text-white/55">
          <span>{counts.issues} issues</span>
          <span>{counts.tasks} tasks</span>
          <span>{counts.epics} epics</span>
          <span>{counts.active} active</span>
          <span>{project.status.replace(/_/g, " ")}</span>
        </div>
      </section>

      <section className="mt-10">
        <RepositoryPanel projectId={project.id} />
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Project Board</h2>
          <span className="text-sm text-white/45">{workItems.length} items</span>
        </div>
        <WorkItemBoard
          items={workItems.map((item: any) => ({
            id: item.id,
            identifier: item.identifier,
            title: item.title,
            status: item.status,
            kind: item.kind,
          }))}
        />
      </section>
    </main>
  );
}
