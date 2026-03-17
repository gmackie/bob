import React from "react";
import Link from "next/link";

import { getTaskWorkspaceHref } from "~/lib/planning/task-workspace";
import { PromoteToTaskButton } from "./promote-to-task-button";

interface WorkItemDetailCardProps {
  workItem: {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    kind: string;
    status: string;
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
    createdAt: Date;
  }>;
  currentArtifacts: Array<{
    id: string;
    artifactRole: string;
    url: string;
    title: string | null;
  }>;
}

function getWorkItemSemanticCopy(kind: string) {
  if (kind === "task") {
    return {
      summary: "Tasks are the executable unit for Bob Builder.",
      hint:
        "Open the execution workspace to chat with Bob, review status, and inspect artifacts.",
    };
  }

  if (kind === "epic") {
    return {
      summary: "Epics organize work before execution begins.",
      hint: "Promote this work item to a task when it is ready to run with Bob.",
    };
  }

  return {
    summary: "Issues capture work to be shaped before execution.",
    hint: "Promote this work item to a task when it is ready for Bob.",
  };
}

export function WorkItemDetailCard({
  workItem,
  childCount,
  comments,
  currentArtifacts,
}: WorkItemDetailCardProps) {
  const semanticCopy = getWorkItemSemanticCopy(workItem.kind);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-accent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
              {workItem.identifier}
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold text-foreground">
              {workItem.title}
            </h1>
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

        <div className="mt-5 flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span>{workItem.kind}</span>
          <span>{workItem.status.replace(/_/g, " ")}</span>
          <span>{childCount} child item{childCount === 1 ? "" : "s"}</span>
          <span>{comments.length} comments</span>
        </div>

        <div className="mt-5 space-y-2">
          <div className="text-sm font-medium text-foreground">{semanticCopy.summary}</div>
          <div className="text-sm text-muted-foreground">{semanticCopy.hint}</div>
        </div>

        <div className="mt-5">
          {workItem.kind === "task" ? (
            <Link
              href={getTaskWorkspaceHref(workItem.id)}
              className="inline-flex rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              Open execution workspace
            </Link>
          ) : (
            <PromoteToTaskButton workItemId={workItem.id} />
          )}
        </div>

        <p className="mt-6 max-w-3xl whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
          {workItem.description?.trim() || "No description yet."}
        </p>
      </section>

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
                  <div className="text-xs text-muted-foreground">{comment.userId}</div>
                  <div className="mt-2 whitespace-pre-wrap text-sm text-secondary-foreground">
                    {comment.body}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-secondary p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Current Artifacts</h2>
          <div className="mt-4 space-y-3">
            {currentArtifacts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                No artifacts attached.
              </div>
            ) : (
              currentArtifacts.map((artifact) => (
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
                </a>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
