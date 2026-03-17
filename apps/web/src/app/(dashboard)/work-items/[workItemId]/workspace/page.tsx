import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { WorkspaceControls } from "~/components/work-items/workspace-controls";
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
          : "border-border bg-accent text-muted-foreground";

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Breadcrumbs
        items={[
          { label: "Planning", href: "/planning" },
          ...(detail.workItem.project
            ? [
                {
                  label: detail.workItem.project.key,
                  href: `/projects/${detail.workItem.project.id}`,
                },
              ]
            : []),
          {
            label: detail.workItem.identifier,
            href: getTaskWorkspaceHref(detail.workItem.id).replace("/workspace", ""),
          },
          { label: "Workspace" },
        ]}
        className="mb-4"
      />

      <section className="mt-6 rounded-[2rem] border border-border bg-accent p-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl">
            <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
              {detail.workItem.identifier}
            </div>
            <h1 className="mt-3 font-display text-3xl font-semibold text-foreground">
              {detail.workItem.title}
            </h1>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
              {detail.workItem.description?.trim() || "No task brief has been written yet."}
            </p>
          </div>

          <div className="min-w-[260px] rounded-3xl border border-border bg-secondary p-5">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Workspace status
            </div>
            <div className="mt-3 text-lg font-semibold text-foreground">
              {target.state === "active"
                ? workflowState?.workflowStatus?.replace(/_/g, " ") ?? "active"
                : target.canExecute
                  ? "idle"
                  : "unavailable"}
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {target.canExecute
                ? workflowState?.statusMessage ??
                  "Use this execution workspace to review context, validation evidence, and the latest handoff before resuming work with Bob."
                : "Only task work items can open the execution workspace."}
            </p>
            {activeSession ? (
              <div className="mt-4 rounded-2xl border border-border bg-accent px-4 py-4 text-sm text-muted-foreground">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Live session
                </div>
                <div className="mt-2 text-foreground">
                  {activeSession.title?.trim() || activeSession.id}
                </div>
                {activeSession.workingDirectory ? (
                  <div className="mt-1 break-all text-xs text-muted-foreground">
                    {activeSession.workingDirectory}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4">
              <WorkspaceControls
                workItemId={detail.workItem.id}
                workItemIdentifier={detail.workItem.identifier}
                activeSessionId={activeSessionId}
                canExecute={target.canExecute}
                liveHref={target.liveHref ?? null}
              />
            </div>
            <div className="mt-3">
              <Link
                href={getTaskWorkspaceHref(detail.workItem.id).replace("/workspace", "")}
                className="rounded-full border border-border px-4 py-2 text-sm text-secondary-foreground transition hover:border-muted-foreground/30 hover:text-foreground"
              >
                Back to work item
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-border bg-secondary p-6">
            <h2 className="font-display text-lg font-semibold text-foreground">Task context</h2>
            <div className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              <div className="rounded-2xl border border-border bg-accent px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Planning state
                </div>
                <div className="mt-2 text-foreground">
                  {detail.workItem.status.replace(/_/g, " ")}
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-accent px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Child work
                </div>
                <div className="mt-2 text-foreground">
                  {detail.childCount} child item{detail.childCount === 1 ? "" : "s"}
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-accent px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Discussion
                </div>
                <div className="mt-2 text-foreground">{comments.length} handoff note(s)</div>
              </div>
              <div className="rounded-2xl border border-border bg-accent px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Active run
                </div>
                <div className="mt-2 text-foreground">
                  {target.activeRun?.status.replace(/_/g, " ") ?? "No active run"}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-border bg-secondary p-6">
            <h2 className="font-display text-lg font-semibold text-foreground">Current artifacts</h2>
            <div className="mt-4 space-y-3">
              {detail.currentArtifacts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  No current artifacts are attached to this task yet.
                </div>
              ) : (
                detail.currentArtifacts.map((artifact: any) => (
                  <a
                    key={artifact.id}
                    href={artifact.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-2xl border border-border bg-accent px-4 py-4 transition hover:border-muted-foreground/30 hover:bg-accent"
                  >
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      {artifact.artifactRole}
                    </div>
                    <div className="mt-2 text-sm text-foreground">
                      {artifact.title?.trim() || artifact.url}
                    </div>
                    {artifact.summary ? (
                      <div className="mt-2 text-sm text-muted-foreground">{artifact.summary}</div>
                    ) : null}
                  </a>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-border bg-secondary p-6">
            <h2 className="font-display text-lg font-semibold text-foreground">Validation state</h2>
            <div className={`mt-4 rounded-2xl border px-4 py-4 ${validationToneClass}`}>
              <div className="text-xs uppercase tracking-[0.18em] opacity-70">
                {validationState.label}
              </div>
              <div className="mt-2 text-sm leading-6">{validationState.detail}</div>
            </div>
            {workflowState ? (
              <div className="mt-4 rounded-2xl border border-border bg-accent px-4 py-4 text-sm text-muted-foreground">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Active workflow
                </div>
                <div className="mt-2 text-foreground">
                  {workflowState.workflowStatus.replace(/_/g, " ")}
                </div>
                {workflowState.statusMessage ? (
                  <div className="mt-2">{workflowState.statusMessage}</div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-border bg-secondary p-6">
            <h2 className="font-display text-lg font-semibold text-foreground">Run history</h2>
            <div className="mt-4 space-y-3">
              {taskRuns.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  No runs have been recorded for this task yet.
                </div>
              ) : (
                taskRuns.map((run: any) => (
                  <div
                    key={run.id}
                    className="rounded-2xl border border-border bg-accent px-4 py-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          {run.status.replace(/_/g, " ")}
                        </div>
                        <div className="mt-2 text-sm text-foreground">
                          {run.branch?.trim() || "No branch recorded"}
                        </div>
                      </div>
                      {run.sessionId ? (
                        <Link
                          href={`/chat?mode=headless&session=${run.sessionId}`}
                          className="rounded-full border border-border px-3 py-1 text-xs text-secondary-foreground transition hover:border-muted-foreground/30 hover:text-foreground"
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

          <div className="rounded-3xl border border-border bg-secondary p-6">
            <h2 className="font-display text-lg font-semibold text-foreground">Handoff context</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-border bg-accent px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Task brief
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {detail.workItem.description?.trim() || "No task brief recorded."}
                </div>
              </div>
              {handoffComments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                  No handoff comments yet.
                </div>
              ) : (
                handoffComments.map((comment: any) => (
                  <div
                    key={comment.id}
                    className="rounded-2xl border border-border bg-accent px-4 py-4"
                  >
                    <div className="text-xs text-muted-foreground">{comment.userId}</div>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
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
