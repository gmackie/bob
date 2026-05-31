import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { ActivityTimeline } from "~/components/work-items/activity-timeline";
import { WorkspaceControls } from "~/components/work-items/workspace-controls";
import { WorkspaceLayout } from "~/components/workspace/workspace-layout";
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
  const validationState = deriveTaskWorkspaceValidationState(
    detail.currentArtifacts,
  );
  const handoffComments = comments.slice(0, 3);

  const validationToneClass =
    validationState.tone === "positive"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
      : validationState.tone === "critical"
        ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
        : validationState.tone === "warning"
          ? "border-amber-400/30 bg-amber-500/10 text-amber-100"
          : "border-border bg-accent text-muted-foreground";

  const worktreePath = activeSession?.workingDirectory ?? null;
  const branchName = target.activeRun?.branch?.trim() ?? null;

  return (
    <WorkspaceLayout
      rootPath={worktreePath}
      branchName={branchName}
      activeSessionId={activeSessionId}
    >
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
              href: getTaskWorkspaceHref(detail.workItem.id).replace(
                "/workspace",
                "",
              ),
            },
            { label: "Workspace" },
          ]}
          className="mb-4"
        />

        <section className="border-border bg-accent mt-6 rounded-[2rem] border p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-3xl">
              <div className="text-muted-foreground font-mono text-xs tracking-[0.24em] uppercase">
                {detail.workItem.identifier}
              </div>
              <h1 className="font-display text-foreground mt-3 text-3xl font-semibold">
                {detail.workItem.title}
              </h1>
              <p className="text-muted-foreground mt-4 text-sm leading-7 whitespace-pre-wrap">
                {detail.workItem.description?.trim() ||
                  "No task brief has been written yet."}
              </p>
            </div>

            <div className="border-border bg-secondary min-w-[260px] rounded-3xl border p-5">
              <div className="text-muted-foreground text-xs tracking-[0.18em] uppercase">
                Workspace status
              </div>
              <div className="text-foreground mt-3 text-lg font-semibold">
                {target.state === "active"
                  ? (workflowState?.workflowStatus?.replace(/_/g, " ") ??
                    "active")
                  : target.canExecute
                    ? "idle"
                    : "unavailable"}
              </div>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                {target.canExecute
                  ? (workflowState?.statusMessage ??
                    "Use this execution workspace to review context, validation evidence, and the latest handoff before resuming work with BizPulse.")
                  : "Only task work items can open the execution workspace."}
              </p>
              {activeSession ? (
                <div className="border-border bg-accent text-muted-foreground mt-4 rounded-2xl border px-4 py-4 text-sm">
                  <div className="text-muted-foreground text-xs tracking-[0.18em] uppercase">
                    Live session
                  </div>
                  <div className="text-foreground mt-2">
                    {activeSession.title?.trim() || activeSession.id}
                  </div>
                  {activeSession.workingDirectory ? (
                    <div className="text-muted-foreground mt-1 text-xs break-all">
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
                  href={getTaskWorkspaceHref(detail.workItem.id).replace(
                    "/workspace",
                    "",
                  )}
                  className="border-border text-secondary-foreground hover:border-muted-foreground/30 hover:text-foreground rounded-full border px-4 py-2 text-sm transition"
                >
                  Back to work item
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="border-border bg-secondary rounded-3xl border p-6">
              <h2 className="font-display text-foreground text-lg font-semibold">
                Task context
              </h2>
              <div className="text-muted-foreground mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="border-border bg-accent rounded-2xl border px-4 py-4">
                  <div className="text-muted-foreground text-xs tracking-[0.18em] uppercase">
                    Planning state
                  </div>
                  <div className="text-foreground mt-2">
                    {detail.workItem.status.replace(/_/g, " ")}
                  </div>
                </div>
                <div className="border-border bg-accent rounded-2xl border px-4 py-4">
                  <div className="text-muted-foreground text-xs tracking-[0.18em] uppercase">
                    Child work
                  </div>
                  <div className="text-foreground mt-2">
                    {detail.childCount} child item
                    {detail.childCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="border-border bg-accent rounded-2xl border px-4 py-4">
                  <div className="text-muted-foreground text-xs tracking-[0.18em] uppercase">
                    Discussion
                  </div>
                  <div className="text-foreground mt-2">
                    {comments.length} handoff note(s)
                  </div>
                </div>
                <div className="border-border bg-accent rounded-2xl border px-4 py-4">
                  <div className="text-muted-foreground text-xs tracking-[0.18em] uppercase">
                    Active run
                  </div>
                  <div className="text-foreground mt-2">
                    {target.activeRun?.status.replace(/_/g, " ") ??
                      "No active run"}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-border bg-secondary rounded-3xl border p-6">
              <h2 className="font-display text-foreground text-lg font-semibold">
                Current artifacts
              </h2>
              <div className="mt-4 space-y-3">
                {detail.currentArtifacts.length === 0 ? (
                  <div className="border-border text-muted-foreground rounded-2xl border border-dashed px-4 py-6 text-sm">
                    No current artifacts are attached to this task yet.
                  </div>
                ) : (
                  detail.currentArtifacts.map((artifact: any) => (
                    <a
                      key={artifact.id}
                      href={artifact.url}
                      target="_blank"
                      rel="noreferrer"
                      className="border-border bg-accent hover:border-muted-foreground/30 hover:bg-accent block rounded-2xl border px-4 py-4 transition"
                    >
                      <div className="text-muted-foreground text-xs tracking-[0.18em] uppercase">
                        {artifact.artifactRole}
                      </div>
                      <div className="text-foreground mt-2 text-sm">
                        {artifact.title?.trim() || artifact.url}
                      </div>
                      {artifact.summary ? (
                        <div className="text-muted-foreground mt-2 text-sm">
                          {artifact.summary}
                        </div>
                      ) : null}
                    </a>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="border-border bg-secondary rounded-3xl border p-6">
              <h2 className="font-display text-foreground text-lg font-semibold">
                Validation state
              </h2>
              <div
                className={`mt-4 rounded-2xl border px-4 py-4 ${validationToneClass}`}
              >
                <div className="text-xs tracking-[0.18em] uppercase opacity-70">
                  {validationState.label}
                </div>
                <div className="mt-2 text-sm leading-6">
                  {validationState.detail}
                </div>
              </div>
              {workflowState ? (
                <div className="border-border bg-accent text-muted-foreground mt-4 rounded-2xl border px-4 py-4 text-sm">
                  <div className="text-muted-foreground text-xs tracking-[0.18em] uppercase">
                    Active workflow
                  </div>
                  <div className="text-foreground mt-2">
                    {workflowState.workflowStatus.replace(/_/g, " ")}
                  </div>
                  {workflowState.statusMessage ? (
                    <div className="mt-2">{workflowState.statusMessage}</div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="border-border bg-secondary rounded-3xl border p-6">
              <h2 className="font-display text-foreground text-lg font-semibold">
                Run history
              </h2>
              <div className="mt-4 space-y-3">
                {taskRuns.length === 0 ? (
                  <div className="border-border text-muted-foreground rounded-2xl border border-dashed px-4 py-6 text-sm">
                    No runs have been recorded for this task yet.
                  </div>
                ) : (
                  taskRuns.map((run: any) => (
                    <div
                      key={run.id}
                      className="border-border bg-accent rounded-2xl border px-4 py-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-muted-foreground text-xs tracking-[0.18em] uppercase">
                            {run.status.replace(/_/g, " ")}
                          </div>
                          <div className="text-foreground mt-2 text-sm">
                            {run.branch?.trim() || "No branch recorded"}
                          </div>
                        </div>
                        {run.sessionId ? (
                          <Link
                            href={`/chat?mode=headless&session=${run.sessionId}`}
                            className="border-border text-secondary-foreground hover:border-muted-foreground/30 hover:text-foreground rounded-full border px-3 py-1 text-xs transition"
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

            <div className="border-border bg-secondary rounded-3xl border p-6">
              <h2 className="font-display text-foreground text-lg font-semibold">
                Activity
              </h2>
              <div className="mt-4">
                <ActivityTimeline
                  workItemId={detail.workItem.id}
                  live={!!activeSessionId}
                />
              </div>
            </div>

            <div className="border-border bg-secondary rounded-3xl border p-6">
              <h2 className="font-display text-foreground text-lg font-semibold">
                Handoff context
              </h2>
              <div className="mt-4 space-y-3">
                <div className="border-border bg-accent rounded-2xl border px-4 py-4">
                  <div className="text-muted-foreground text-xs tracking-[0.18em] uppercase">
                    Task brief
                  </div>
                  <div className="text-muted-foreground mt-2 text-sm leading-6 whitespace-pre-wrap">
                    {detail.workItem.description?.trim() ||
                      "No task brief recorded."}
                  </div>
                </div>
                {handoffComments.length === 0 ? (
                  <div className="border-border text-muted-foreground rounded-2xl border border-dashed px-4 py-6 text-sm">
                    No handoff comments yet.
                  </div>
                ) : (
                  handoffComments.map((comment: any) => (
                    <div
                      key={comment.id}
                      className="border-border bg-accent rounded-2xl border px-4 py-4"
                    >
                      <div className="text-muted-foreground text-xs">
                        {comment.userId}
                      </div>
                      <div className="text-muted-foreground mt-2 text-sm leading-6 whitespace-pre-wrap">
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
    </WorkspaceLayout>
  );
}
