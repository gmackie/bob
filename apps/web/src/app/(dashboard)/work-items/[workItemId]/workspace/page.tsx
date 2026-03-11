import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createPlanningCaller } from "~/lib/planning/server";
import {
  getTaskWorkspaceHref,
  resolveTaskWorkspaceTarget,
} from "~/lib/planning/task-workspace";

interface TaskWorkspacePageProps {
  params: Promise<{ workItemId: string }>;
}

export const dynamic = "force-dynamic";

export default async function TaskWorkspacePage({
  params,
}: TaskWorkspacePageProps) {
  const { workItemId } = await params;
  const caller = (await createPlanningCaller()) as any;

  const [detail, taskRuns] = await Promise.all([
    caller.workItem.get({ id: workItemId }),
    caller.taskRun.listByWorkItem({ workItemId }),
  ]);

  if (!detail) {
    notFound();
  }

  const target = resolveTaskWorkspaceTarget({
    workItem: {
      id: detail.workItem.id,
      kind: detail.workItem.kind,
    },
    taskRuns,
  });

  if (target.href) {
    redirect(target.href);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8">
        <div className="text-xs uppercase tracking-[0.24em] text-white/40">
          {detail.workItem.identifier}
        </div>
        <h1 className="mt-3 text-3xl font-semibold text-white">
          {detail.workItem.title}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-white/65">
          {target.canExecute
            ? "This task does not have an active execution session yet. Start or resume a run to open the live workspace."
            : "Only scoped tasks can open the execution workspace. Promote this work item into a task before handing it to Bob."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={getTaskWorkspaceHref(detail.workItem.id).replace("/workspace", "")}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/70 transition hover:border-white/25 hover:text-white"
          >
            Back to work item
          </Link>
          <Link
            href="/chat"
            className="rounded-full bg-[#f59e0b] px-4 py-2 text-sm font-medium text-black transition hover:bg-[#f8b84b]"
          >
            Open session console
          </Link>
        </div>
      </div>
    </main>
  );
}
