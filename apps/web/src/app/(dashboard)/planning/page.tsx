import React from "react";
import Link from "next/link";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { CreateProjectButton } from "~/components/projects/create-project-button";
import { ProjectCard } from "~/components/projects/project-card";
import { StartPlanningButton } from "~/components/planning/start-planning-button";
import { CreateWorkItemButton } from "~/components/work-items/create-work-item-button";
import { summarizeProjects } from "~/components/work-items/planning-utils";
import { FilterableBoard } from "~/components/work-items/board-filter-bar";
import { createPlanningCaller } from "~/lib/planning/server";

export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const caller = (await createPlanningCaller()) as any;
  const workspaces = await caller.workspace.list();
  const currentWorkspace = workspaces[0]?.workspace ?? null;

  if (!currentWorkspace) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="rounded-3xl border border-white/10 bg-black/20 px-8 py-12 text-center">
          <div className="text-xs uppercase tracking-[0.28em] text-white/35">
            Builder Planning
          </div>
          <h1 className="mt-4 text-3xl font-semibold text-white">
            No workspace yet
          </h1>
          <p className="mt-3 text-sm text-white/60">
            Create your first workspace through the API to unlock projects and work
            items in the merged shell.
          </p>
        </div>
      </main>
    );
  }

  const [projects, workItems] = await Promise.all([
    caller.project.list({ workspaceId: currentWorkspace.id }),
    caller.workItem.list({ workspaceId: currentWorkspace.id, limit: 100 }),
  ]);
  const projectCards = summarizeProjects(projects);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Breadcrumbs items={[{ label: "Planning" }]} className="mb-4" />

      <section className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#0e1628] via-[#13243a] to-[#0d111c] px-8 py-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-white/35">
              Builder Planning
            </div>
            <h1 className="mt-3 text-4xl font-semibold text-white">
              {currentWorkspace.name}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62">
              Intake, scope, and execution now live in one shell. Use this view to
              scan active work before opening a task&apos;s execution workspace.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StartPlanningButton
              workspaceId={currentWorkspace.id}
              projectId={projects[0]?.project?.id ?? ""}
              projectName={projects[0]?.project?.name}
            />
            <CreateWorkItemButton
              projects={projects.map((p: any) => ({
                id: p.project.id,
                name: p.project.name,
                key: p.project.key,
              }))}
            />
            <Link
              href="/chat"
              className="rounded-full border border-white/12 px-4 py-2 text-sm text-white/70 transition hover:border-white/20 hover:text-white"
            >
              Open Execution Workspace
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">Projects</h2>
            <CreateProjectButton workspaceId={currentWorkspace.id} />
          </div>
          <span className="text-sm text-white/45">{projectCards.length} total</span>
        </div>
        {projectCards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 px-6 py-8 text-center">
            <div className="text-sm text-white/45">No projects yet.</div>
            <div className="mt-1 text-xs text-white/30">
              Create your first project to start organizing work items.
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {projectCards.map((project) => (
              <ProjectCard key={project.id} {...project} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Work Board</h2>
          <span className="text-sm text-white/45">{workItems.length} visible items</span>
        </div>
        <FilterableBoard
          items={workItems.map((item: any) => ({
            id: item.id,
            identifier: item.identifier,
            title: item.title,
            status: item.status,
            kind: item.kind,
            priority: item.priority,
          }))}
          projects={projects.map((p: any) => ({
            id: p.project.id,
            key: p.project.key,
          }))}
        />
      </section>
    </main>
  );
}
