"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@bob/ui/toast";
import { Badge } from "@bob/ui/badge";

import { OpenChatPanelButton } from "~/components/chat/open-chat-panel-button";
import { KIND_COLOR, formatLabel } from "~/lib/design/colors";
import { formatRelativeTime } from "~/lib/format/time";
import { getTaskWorkspaceHref } from "~/lib/planning/task-workspace";
import { useTRPC } from "~/trpc/react";

import { FeatureBranchView } from "~/components/pull-requests/feature-branch-view";
import { ActivityTimeline } from "./activity-timeline";
import { AddCommentForm } from "./add-comment-form";
import { ArtifactCardGrid } from "./artifact-card";
import { DescriptionEditor } from "./description-editor";
import { EditableTitle } from "./editable-title";
import { ForgeGraphSection } from "./forge-graph-section";
import { PriorityBadge } from "./priority-badge";
import { PromoteToTaskButton } from "./promote-to-task-button";
import { RequirementsChecklist } from "./requirements-checklist";
import { StatusSelect } from "./status-select";

interface WorkItemDetailInteractiveProps {
  workItem: {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    kind: string;
    status: string;
    priority: string;
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
    url: string;
    title: string | null;
  }>;
}

export function WorkItemDetailInteractive({
  workItem,
  childCount,
  comments,
  currentArtifacts,
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

  const isPending = updateTask.isPending;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-accent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
              {workItem.identifier}
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
          <RequirementsChecklist
            workItemId={workItem.id}
            workItemKind={workItem.kind}
          />
        </section>
      )}

      {workItem.kind === "epic" && (
        <section className="rounded-3xl border border-border bg-secondary p-6">
          <FeatureBranchView workItemId={workItem.id} />
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
            <ActivityTimeline workItemId={workItem.id} />
          </div>
        </div>

        {workItem.kind === "task" && (
          <ForgeGraphSection taskId={workItem.id} />
        )}
      </section>
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
