import Link from "next/link";

import { ProjectCard } from "~/components/projects/project-card";
import { summarizeProjects } from "~/components/work-items/planning-utils";
import { WorkItemBoard } from "~/components/work-items/work-item-board";
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
              scan active work before jumping into a task workspace.
            </p>
          </div>
          <Link
            href="/chat"
            className="rounded-full border border-white/12 px-4 py-2 text-sm text-white/70 transition hover:border-white/20 hover:text-white"
          >
            Open Execution Workspace
          </Link>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Projects</h2>
          <span className="text-sm text-white/45">{projectCards.length} total</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {projectCards.map((project) => (
            <ProjectCard key={project.id} {...project} />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Work Board</h2>
          <span className="text-sm text-white/45">{workItems.length} visible items</span>
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
