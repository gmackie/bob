import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { createPlanningCaller } from "~/lib/planning/server";
import {
  deriveTaskWorkspaceValidationState,
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

  const [detail, comments, taskRuns] = await Promise.all([
    caller.workItem.get({ id: workItemId }),
    caller.comment.listByWorkItem({ workItemId }),
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

  const activeSessionId = target.activeRun?.sessionId ?? null;
  const [activeSession, workflowState] = activeSessionId
    ? await Promise.all([
        caller.session.get({ id: activeSessionId }),
        caller.session.getWorkflowState({ sessionId: activeSessionId }),
      ])
    : [null, null];
  const validationState = deriveTaskWorkspaceValidationState(detail.currentArtifacts);
  const handoffComments = comments.slice(0, 3);

  const validationToneClass =
    validationState.tone === "positive"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
      : validationState.tone === "critical"
        ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
        : validationState.tone === "warning"
          ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
          : "border-white/10 bg-white/[0.04] text-white/72";

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center gap-3 text-sm text-white/45">
        <Link href="/planning" className="transition hover:text-white">
          Planning
        </Link>
        {detail.workItem.project ? (
          <>
            <span>/</span>
            <Link
              href={`/projects/${detail.workItem.project.id}`}
              className="transition hover:text-white"
            >
              {detail.workItem.project.key}
            </Link>
          </>
        ) : null}
        <span>/</span>
        <Link
          href={getTaskWorkspaceHref(detail.workItem.id).replace("/workspace", "")}
          className="transition hover:text-white"
        >
          {detail.workItem.identifier}
        </Link>
      </div>

      <section className="mt-6 rounded-[2rem] border border-white/10 bg-white/[0.04] p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.24em] text-white/40">
              {detail.workItem.identifier}
            </div>
            <h1 className="mt-3 text-3xl font-semibold text-white">
              {detail.workItem.title}
            </h1>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-white/68">
              {detail.workItem.description?.trim() || "No task brief has been written yet."}
            </p>
          </div>

          <div className="min-w-[260px] rounded-3xl border border-white/10 bg-black/20 p-5">
            <div className="text-xs uppercase tracking-[0.18em] text-white/35">
              Workspace status
            </div>
            <div className="mt-3 text-lg font-semibold text-white">
              {target.state === "active"
                ? workflowState?.workflowStatus?.replace(/_/g, " ") ?? "active"
                : target.canExecute
                  ? "idle"
                  : "unavailable"}
            </div>
            <p className="mt-2 text-sm leading-6 text-white/62">
              {target.canExecute
                ? workflowState?.statusMessage ??
                  "Use this execution workspace to review context, validation evidence, and the latest handoff before resuming work with Bob."
                : "Only task work items can open the execution workspace."}
            </p>
            {activeSession ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-white/68">
                <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                  Live session
                </div>
                <div className="mt-2 text-white">
                  {activeSession.title?.trim() || activeSession.id}
                </div>
                {activeSession.workingDirectory ? (
                  <div className="mt-1 break-all text-xs text-white/45">
                    {activeSession.workingDirectory}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              {target.liveHref ? (
                <Link
                  href={target.liveHref}
                  className="rounded-full bg-[#f59e0b] px-4 py-2 text-sm font-medium text-black transition hover:bg-[#f8b84b]"
                >
                  Resume live workspace
                </Link>
              ) : (
                <Link
                  href="/chat"
                  className="rounded-full bg-[#f59e0b] px-4 py-2 text-sm font-medium text-black transition hover:bg-[#f8b84b]"
                >
                  Open session console
                </Link>
              )}
              <Link
                href={getTaskWorkspaceHref(detail.workItem.id).replace("/workspace", "")}
                className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/70 transition hover:border-white/25 hover:text-white"
              >
                Back to work item
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
            <h2 className="text-lg font-semibold text-white">Task context</h2>
            <div className="mt-4 grid gap-3 text-sm text-white/68 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                  Planning state
                </div>
                <div className="mt-2 text-white">
                  {detail.workItem.status.replace(/_/g, " ")}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                  Child work
                </div>
                <div className="mt-2 text-white">
                  {detail.childCount} child item{detail.childCount === 1 ? "" : "s"}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                  Discussion
                </div>
                <div className="mt-2 text-white">{comments.length} handoff note(s)</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                  Active run
                </div>
                <div className="mt-2 text-white">
                  {target.activeRun?.status.replace(/_/g, " ") ?? "No active run"}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
            <h2 className="text-lg font-semibold text-white">Current artifacts</h2>
            <div className="mt-4 space-y-3">
              {detail.currentArtifacts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/35">
                  No current artifacts are attached to this task yet.
                </div>
              ) : (
                detail.currentArtifacts.map((artifact: any) => (
                  <a
                    key={artifact.id}
                    href={artifact.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 transition hover:border-white/20 hover:bg-white/[0.06]"
                  >
                    <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                      {artifact.artifactRole}
                    </div>
                    <div className="mt-2 text-sm text-white">
                      {artifact.title?.trim() || artifact.url}
                    </div>
                    {artifact.summary ? (
                      <div className="mt-2 text-sm text-white/60">{artifact.summary}</div>
                    ) : null}
                  </a>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
            <h2 className="text-lg font-semibold text-white">Validation state</h2>
            <div className={`mt-4 rounded-2xl border px-4 py-4 ${validationToneClass}`}>
              <div className="text-xs uppercase tracking-[0.18em] opacity-70">
                {validationState.label}
              </div>
              <div className="mt-2 text-sm leading-6">{validationState.detail}</div>
            </div>
            {workflowState ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-white/68">
                <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                  Active workflow
                </div>
                <div className="mt-2 text-white">
                  {workflowState.workflowStatus.replace(/_/g, " ")}
                </div>
                {workflowState.statusMessage ? (
                  <div className="mt-2">{workflowState.statusMessage}</div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
            <h2 className="text-lg font-semibold text-white">Run history</h2>
            <div className="mt-4 space-y-3">
              {taskRuns.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/35">
                  No runs have been recorded for this task yet.
                </div>
              ) : (
                taskRuns.map((run: any) => (
                  <div
                    key={run.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                          {run.status.replace(/_/g, " ")}
                        </div>
                        <div className="mt-2 text-sm text-white">
                          {run.branch?.trim() || "No branch recorded"}
                        </div>
                      </div>
                      {run.sessionId ? (
                        <Link
                          href={`/chat?mode=headless&session=${run.sessionId}`}
                          className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 transition hover:border-white/25 hover:text-white"
                        >
                          Open run
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
            <h2 className="text-lg font-semibold text-white">Handoff context</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                  Task brief
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/68">
                  {detail.workItem.description?.trim() || "No task brief recorded."}
                </div>
              </div>
              {handoffComments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/35">
                  No handoff comments yet.
                </div>
              ) : (
                handoffComments.map((comment: any) => (
                  <div
                    key={comment.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4"
                  >
                    <div className="text-xs text-white/35">{comment.userId}</div>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/72">
                      {comment.body}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
