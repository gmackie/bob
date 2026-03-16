"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@bob/ui/toast";
import { Badge } from "@bob/ui/badge";

import { OpenChatPanelButton } from "~/components/chat/open-chat-panel-button";
import { BuildHistory } from "~/components/forgegraph/build-history";
import { DeploymentStatus } from "~/components/forgegraph/deployment-status";
import { RevisionStatusBar } from "~/components/forgegraph/revision-status-bar";
import { KIND_COLOR, formatLabel } from "~/lib/design/colors";
import { formatRelativeTime } from "~/lib/format/time";
import { getTaskWorkspaceHref } from "~/lib/planning/task-workspace";
import { useTRPC } from "~/trpc/react";

import { AddCommentForm } from "./add-comment-form";
import { DescriptionEditor } from "./description-editor";
import { EditableTitle } from "./editable-title";
import { PriorityBadge } from "./priority-badge";
import { PromoteToTaskButton } from "./promote-to-task-button";
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
      <section className="rounded-3xl border border-white/10 bg-white/[0.05] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-white/45">
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
              className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60 transition hover:border-white/20 hover:text-white"
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
          <span className="text-sm text-white/45">
            {childCount} child item{childCount === 1 ? "" : "s"}
          </span>
          <span className="text-sm text-white/45">
            {comments.length} comments
          </span>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {workItem.kind === "task" ? (
            <>
              <Link
                href={getTaskWorkspaceHref(workItem.id)}
                className="inline-flex rounded-full bg-[#f59e0b] px-4 py-2 text-sm font-medium text-black transition hover:bg-[#f8b84b]"
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

      <section className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
          <h2 className="text-lg font-semibold text-white">Discussion</h2>
          <div className="mt-4 space-y-4">
            {comments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/35">
                No comments yet.
              </div>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4"
                >
                  <div className="flex items-center gap-2 text-xs text-white/35">
                    <span className="font-medium text-white/50">
                      {formatUserId(comment.userId)}
                    </span>
                    <span>{formatRelativeTime(comment.createdAt)}</span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-white/75">
                    {comment.body}
                  </div>
                </div>
              ))
            )}
            <AddCommentForm issueId={workItem.id} />
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
          <h2 className="text-lg font-semibold text-white">Current Artifacts</h2>
          <div className="mt-4 space-y-3">
            {currentArtifacts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/35">
                No artifacts attached.
              </div>
            ) : (
              currentArtifacts.map((artifact) => (
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
                </a>
              ))
            )}
          </div>
        </div>

        {workItem.kind === "task" && (
          <ForgeGraphSection taskId={workItem.id} />
        )}
      </section>
    </div>
  );
}

function ForgeGraphSection({ taskId }: { taskId: string }) {
  const trpc = useTRPC();
  const { data } = useQuery(
    trpc.forgegraph.listRevisions.queryOptions(
      { taskId, limit: 1 },
      { staleTime: 30_000 },
    ),
  );

  const latestRevisionId = data?.[0]?.id ?? null;

  const { data: builds } = useQuery({
    ...trpc.forgegraph.listBuilds.queryOptions(
      { revisionId: latestRevisionId! },
    ),
    enabled: !!latestRevisionId,
    staleTime: 30_000,
  });

  const { data: deployments } = useQuery({
    ...trpc.forgegraph.listDeployments.queryOptions(
      { revisionId: latestRevisionId! },
    ),
    enabled: !!latestRevisionId,
    staleTime: 30_000,
  });

  if (!data || data.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
        <h2 className="text-lg font-semibold text-white">Build & Deploy</h2>
        <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/35">
          No revisions linked to this task.
        </div>
      </div>
    );
  }

  const latest = data[0]!;

  return (
    <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
      <h2 className="text-lg font-semibold text-white">Build & Deploy</h2>
      <div className="mt-4 space-y-5">
        <RevisionStatusBar
          gates={latest.gates ?? []}
          commitSha={latest.revId}
          branch={latest.branch ?? undefined}
        />

        {builds && builds.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-white/60">Builds</h3>
            <BuildHistory builds={builds} />
          </div>
        )}

        {deployments && deployments.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-white/60">
              Deployments
            </h3>
            <DeploymentStatus deployments={deployments} />
          </div>
        )}
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
