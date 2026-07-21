"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@gmacko/core/ui/toast";
import { Badge } from "@gmacko/core/ui/badge";

import { ErrorBoundary } from "@gmacko/core/ui/error-boundary";
import { OpenChatPanelButton } from "~/components/chat/open-chat-panel-button";
import { KIND_COLOR, formatLabel } from "~/lib/design/colors";
import { formatRelativeTime } from "~/lib/format/time";
import { getTaskWorkspaceHref } from "~/lib/planning/task-workspace";
import { useTRPC } from "~/trpc/react";

import { FeatureBranchView } from "~/components/pull-requests/feature-branch-view";
import {
  collapseSessionEventsToMessages,
  normalizeSessionEventRecords,
} from "~/components/runs/session-event-format";
import { ActivityTimeline } from "./activity-timeline";
import { AddCommentForm } from "./add-comment-form";
import { ArtifactCardGrid } from "./artifact-card";
import { DescriptionEditor } from "./description-editor";
import { EditableTitle } from "./editable-title";
import { ForgeGraphSection } from "./forge-graph-section";
import { LifecycleTimelineSection } from "./lifecycle-timeline-section";
import { AgentSelect } from "./agent-select";
import { PriorityBadge } from "./priority-badge";
import { PromoteToTaskButton } from "./promote-to-task-button";
import { RequirementsChecklist } from "./requirements-checklist";
import { StatusSelect } from "./status-select";
import {
  getWorkItemOutcomeSessionHref,
  getWorkItemEntryAction,
  getWorkItemEntryValidationState,
  getWorkItemEntryPlanSessionHref,
  getWorkItemEntryRelatedQueueHref,
  selectLatestSessionBackedOutcomeRun,
  type WorkItemEntryValidationState,
  type WorkItemEntryContext,
  type WorkItemOutcomeRun,
  type WorkItemEntryRelatedWorkItem,
} from "./work-item-entry-model";

interface WorkItemDetailInteractiveProps {
  workItem: {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    kind: string;
    status: string;
    priority: string;
    agentTypeOverride?: string | null;
    queueSortOrder?: number | null;
    agentStatus?: {
      sessionId: string;
      status: string;
      agentType?: string | null;
    } | null;
    dependencies?: WorkItemEntryRelatedWorkItem[] | null;
    dependents?: WorkItemEntryRelatedWorkItem[] | null;
    project: {
      id: string;
      name: string;
      key: string;
    } | null;
  };
  childCount: number;
  comments: Array<{
    id: string;
    body: string;
    userId: string;
    createdAt: string;
  }>;
  currentArtifacts: Array<{
    id: string;
    artifactRole: string;
    artifactType?: string | null;
    url: string;
    title: string | null;
    summary?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  entryContext?: WorkItemEntryContext;
}

export function WorkItemDetailInteractive({
  workItem,
  childCount,
  comments,
  currentArtifacts,
  entryContext,
}: WorkItemDetailInteractiveProps) {
  const router = useRouter();
  const trpc = useTRPC();

  const updateTask = useMutation(
    trpc.planning.updateTask.mutationOptions({
      onSuccess: () => {
        router.refresh();
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );
  const dispatchWork = useMutation(
    trpc.workItem.dispatch.mutationOptions({
      onSuccess: (result: any) => {
        if (typeof result?.sessionId === "string") {
          router.push(getWorkItemOutcomeSessionHref(result.sessionId, entryContext?.workspaceId));
          return;
        }
        router.refresh();
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const updateAgent = useMutation(
    trpc.workItems.update.mutationOptions({
      onSuccess: () => {
        router.refresh();
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const isPending = updateTask.isPending;
  const entryAction = entryContext
    ? getWorkItemEntryAction({
        view: entryContext.view,
        workspaceId: entryContext.workspaceId,
        workItem,
      })
    : null;
  const validationState = getWorkItemEntryValidationState(currentArtifacts);
  const showValidationState = entryContext?.sections.some(
    (section) =>
      section.key === "artifacts-validation" || section.key === "validation-review",
  );

  return (
    <div className="space-y-6">
      {entryContext ? (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {entryContext.label}
              </div>
              <h2 className="mt-1 font-display text-lg font-semibold text-foreground">
                {entryContext.heading}
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {entryContext.description}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Agent:
                <AgentSelect
                  value={workItem.agentTypeOverride}
                  disabled={updateAgent.isPending}
                  inheritLabel="Inherit default"
                  onValueChange={(agentTypeOverride) =>
                    updateAgent.mutate({ id: workItem.id, agentTypeOverride })
                  }
                />
              </span>
              {entryAction?.kind === "live-session" ? (
                <Link
                  href={entryAction.href}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {entryAction.label}
                </Link>
              ) : entryAction?.kind === "dispatch" || entryAction?.kind === "rerun" ? (
                <button
                  type="button"
                  onClick={() => dispatchWork.mutate({ workItemId: workItem.id })}
                  disabled={dispatchWork.isPending}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {dispatchWork.isPending ? "Starting..." : entryAction.label}
                </button>
              ) : null}
              <Link
                href={entryContext.backHref}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                Back to {entryContext.label}
              </Link>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {entryContext.facts.map((fact) => (
              <span
                key={fact.label}
                className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
              >
                {fact.label}: <span className="font-medium text-foreground">{fact.value}</span>
              </span>
            ))}
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Detail sections
            </div>
            <div className="flex flex-wrap gap-2">
              {entryContext.sections.map((section) => (
                <span
                  key={section.key}
                  className="rounded-md border border-border bg-background/50 px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {section.label}
                </span>
              ))}
            </div>
          </div>
          {entryContext.dependencySummary ? (
            <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-2">
              <RelatedWorkItemsList
                title="Depends On"
                empty="No dependencies"
                items={entryContext.dependencySummary.dependencies}
                workspaceId={entryContext.workspaceId}
              />
              <RelatedWorkItemsList
                title="Blocking"
                empty="No blocked tasks"
                items={entryContext.dependencySummary.dependents}
                workspaceId={entryContext.workspaceId}
              />
            </div>
          ) : null}
          {showValidationState ? (
            <ValidationStatePanel validationState={validationState} />
          ) : null}
        </section>
      ) : null}

      {entryContext?.view === "outcome" ? (
        <OutcomeReadableOutputPanel
          workItemId={workItem.id}
          workspaceId={entryContext.workspaceId}
        />
      ) : null}

      <section className="rounded-3xl border border-border bg-accent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
              <span className="font-mono">{workItem.identifier}</span>
              <Badge variant={KIND_COLOR[workItem.kind] ?? "default"}>
                {formatLabel(workItem.kind)}
              </Badge>
            </div>
            <div className="mt-2">
              <EditableTitle
                value={workItem.title}
                onSave={(title) =>
                  updateTask.mutateAsync({ id: workItem.id, title })
                }
                disabled={isPending}
              />
            </div>
          </div>
          {workItem.project ? (
            <Link
              href={`/projects/${workItem.project.id}`}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:border-muted-foreground/30 hover:text-foreground"
            >
              {workItem.project.key} · {workItem.project.name}
            </Link>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <StatusSelect
            value={workItem.status}
            onValueChange={(status) =>
              updateTask.mutate({ id: workItem.id, status: status as any })
            }
            disabled={isPending}
          />
          <PriorityBadge
            value={workItem.priority}
            onValueChange={(priority) =>
              updateTask.mutate({ id: workItem.id, priority: priority as any })
            }
            disabled={isPending}
          />
          <span className="text-sm text-muted-foreground">
            {childCount} child item{childCount === 1 ? "" : "s"}
          </span>
          <span className="text-sm text-muted-foreground">
            {comments.length} comments
          </span>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {workItem.kind === "task" ? (
            <>
              <Link
                href={getTaskWorkspaceHref(workItem.id)}
                className="inline-flex rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Open execution workspace
              </Link>
              <OpenChatPanelButton
                workItemId={workItem.id}
                label={workItem.identifier}
              />
            </>
          ) : (
            <PromoteToTaskButton workItemId={workItem.id} />
          )}
        </div>

        <PlanningSessionsList
          workItemId={workItem.id}
          workspaceId={entryContext?.workspaceId}
        />

        <div className="mt-6 max-w-3xl">
          <DescriptionEditor
            value={workItem.description?.trim() ?? ""}
            onSave={(description) =>
              updateTask.mutateAsync({ id: workItem.id, description })
            }
            disabled={isPending}
          />
        </div>
      </section>

      {(workItem.kind === "epic" || workItem.kind === "issue") && (
        <section className="rounded-3xl border border-border bg-secondary p-6">
          <ErrorBoundary section="Requirements">
            <RequirementsChecklist
              workItemId={workItem.id}
              workItemKind={workItem.kind}
            />
          </ErrorBoundary>
        </section>
      )}

      {workItem.kind === "epic" && (
        <section className="rounded-3xl border border-border bg-secondary p-6">
          <ErrorBoundary section="Feature Branches">
            <FeatureBranchView workItemId={workItem.id} />
          </ErrorBoundary>
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-3xl border border-border bg-secondary p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Discussion</h2>
          <div className="mt-4 space-y-4">
            {comments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                No comments yet.
              </div>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-2xl border border-border bg-accent px-4 py-4"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-muted-foreground">
                      {formatUserId(comment.userId)}
                    </span>
                    <span>{formatRelativeTime(comment.createdAt)}</span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-secondary-foreground">
                    {comment.body}
                  </div>
                </div>
              ))
            )}
            <AddCommentForm issueId={workItem.id} />
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-secondary p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Current Artifacts</h2>
          <div className="mt-4">
            <ArtifactCardGrid artifacts={currentArtifacts} />
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-secondary p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Activity</h2>
          <div className="mt-4">
            <ErrorBoundary section="Activity">
              <ActivityTimeline workItemId={workItem.id} />
            </ErrorBoundary>
          </div>
        </div>

        {workItem.kind === "task" && (
          <ErrorBoundary section="Build & Deploy">
            <ForgeGraphSection taskId={workItem.id} />
          </ErrorBoundary>
        )}
      </section>

      <ErrorBoundary section="Lifecycle Events">
        <LifecycleTimelineSection workItemId={workItem.id} />
      </ErrorBoundary>
    </div>
  );
}

function ValidationStatePanel({
  validationState,
}: {
  validationState: WorkItemEntryValidationState;
}) {
  const toneClass =
    validationState.tone === "positive"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
      : validationState.tone === "critical"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
        : validationState.tone === "warning"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
          : "border-border bg-background/50 text-muted-foreground";

  return (
    <div className={`mt-4 rounded-xl border px-3 py-3 ${toneClass}`}>
      <div className="text-xs font-semibold uppercase tracking-wide">
        Validation state
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">
        {validationState.label}
      </div>
      <div className="mt-1 text-sm">{validationState.detail}</div>
    </div>
  );
}

function RelatedWorkItemsList({
  title,
  empty,
  items,
  workspaceId,
}: {
  title: string;
  empty: string;
  items: Array<WorkItemEntryRelatedWorkItem & { statusLabel: string }>;
  workspaceId?: string | null;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {empty}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Link
              key={item.id}
              href={getWorkItemEntryRelatedQueueHref(item.id, workspaceId)}
              className="block rounded-lg border border-border bg-background/50 px-3 py-2 transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-foreground">
                    {item.identifier} · {item.title}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {item.statusLabel}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function OutcomeReadableOutputPanel({
  workItemId,
  workspaceId,
}: {
  workItemId: string;
  workspaceId?: string | null;
}) {
  const trpc = useTRPC();
  const { data: runs, isLoading: runsLoading } = useQuery(
    trpc.agentRun.listByWorkItem.queryOptions(
      { workItemId, limit: 10 },
      { enabled: Boolean(workItemId), refetchInterval: 10_000 },
    ),
  );
  const latestRun = selectLatestSessionBackedOutcomeRun(
    ((runs ?? []) as WorkItemOutcomeRun[]),
  );
  const sessionId = latestRun?.sessionId ?? "";
  const { data: eventData, isLoading: eventsLoading } = useQuery(
    trpc.session.getEvents.queryOptions(
      { sessionId, limit: 200 },
      { enabled: Boolean(sessionId), refetchInterval: 5_000 },
    ),
  );
  const events = normalizeSessionEventRecords(eventData);
  const messages = collapseSessionEventsToMessages(events).slice(-6);
  const isLoading = runsLoading || (Boolean(sessionId) && eventsLoading);

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Readable Output
          </div>
          <h2 className="mt-1 font-display text-lg font-semibold text-foreground">
            Latest execution session
          </h2>
        </div>
        {sessionId ? (
          <Link
            href={getWorkItemOutcomeSessionHref(sessionId, workspaceId)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            Open session
          </Link>
        ) : null}
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          <div className="h-4 animate-pulse rounded bg-muted/50" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted/50" />
        </div>
      ) : !latestRun ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          No execution session has been linked to this outcome yet.
        </p>
      ) : messages.length === 0 ? (
        <p className="mt-4 rounded-lg bg-background/50 px-3 py-3 text-sm text-muted-foreground">
          No readable session output has been recorded yet.
        </p>
      ) : (
        <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border bg-background/40">
          {messages.map((message) => (
            <div key={`${message.role}-${message.seq}`} className="px-3 py-3">
              <div className="mb-1 text-xs font-semibold text-muted-foreground">
                {message.role === "user" ? "You" : "Agent"}
              </div>
              {message.toolCalls?.length ? (
                <div className="font-mono text-xs text-muted-foreground">
                  Tool: {message.toolCalls.map((tool) => tool.name).join(", ")}
                </div>
              ) : (
                <div className="line-clamp-5 whitespace-pre-wrap text-sm leading-relaxed text-secondary-foreground">
                  {message.content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PlanningSessionsList({
  workItemId,
  workspaceId,
}: {
  workItemId: string;
  workspaceId?: string | null;
}) {
  const trpc = useTRPC();
  const { data: sessions } = useQuery(
    trpc.planSession.listByWorkItem.queryOptions(
      { workItemId },
      { staleTime: 10_000 },
    ),
  );
  const sessionRows = Array.isArray(sessions) ? (sessions as any[]) : [];

  if (sessionRows.length === 0) return null;

  const SESSION_TYPE_LABELS: Record<string, string> = {
    office_hours: "Office Hours",
    ceo_review: "CEO Review",
    eng_review: "Eng Review",
    design_review: "Design Review",
    breakdown: "Breakdown",
    shape: "Shape",
  };

  return (
    <div className="mt-5">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Planning Sessions
      </div>
      <div className="flex flex-wrap gap-2">
        {sessionRows.map((s: any) => (
          <Link
            key={s.id}
            href={getWorkItemEntryPlanSessionHref(workItemId, s.id, workspaceId)}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs transition-colors hover:border-primary/30 hover:bg-accent"
          >
            <span
              className={`size-1.5 rounded-full ${
                s.status === "running" || s.status === "idle"
                  ? "bg-emerald-500"
                  : // Paused awaiting a human decision — amber "needs you".
                    s.status === "provisioning" ||
                      s.status === "starting" ||
                      s.status === "blocked"
                    ? "bg-amber-500"
                    : s.status === "error"
                      ? "bg-rose-500"
                      : // host_unknown (contact lost) → muted dot.
                        "bg-muted-foreground"
              }`}
            />
            <span className="font-medium text-foreground">
              {SESSION_TYPE_LABELS[s.planningSessionType] ?? s.title ?? "Session"}
            </span>
            <span className="text-muted-foreground">
              {s.status}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Display a userId as a short readable name. */
function formatUserId(userId: string): string {
  // If it looks like an email, show the local part
  if (userId.includes("@")) return userId.split("@")[0]!;
  // If it looks like a UUID, show a short prefix
  if (userId.length > 20 && userId.includes("-"))
    return userId.slice(0, 8);
  return userId;
}
