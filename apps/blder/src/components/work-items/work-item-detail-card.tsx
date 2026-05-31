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
      summary: "Tasks are the executable unit for BizPulse.",
      hint: "Open the execution workspace to chat with Bob, review status, and inspect artifacts.",
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
      <section className="border-border bg-accent rounded-3xl border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-muted-foreground font-mono text-xs tracking-[0.24em] uppercase">
              {workItem.identifier}
            </div>
            <h1 className="font-display text-foreground mt-2 text-3xl font-semibold">
              {workItem.title}
            </h1>
          </div>
          {workItem.project ? (
            <Link
              href={`/projects/${workItem.project.id}`}
              className="border-border text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground rounded-full border px-3 py-1 text-xs transition"
            >
              {workItem.project.key} · {workItem.project.name}
            </Link>
          ) : null}
        </div>

        <div className="text-muted-foreground mt-5 flex flex-wrap gap-3 text-sm">
          <span>{workItem.kind}</span>
          <span>{workItem.status.replace(/_/g, " ")}</span>
          <span>
            {childCount} child item{childCount === 1 ? "" : "s"}
          </span>
          <span>{comments.length} comments</span>
        </div>

        <div className="mt-5 space-y-2">
          <div className="text-foreground text-sm font-medium">
            {semanticCopy.summary}
          </div>
          <div className="text-muted-foreground text-sm">
            {semanticCopy.hint}
          </div>
        </div>

        <div className="mt-5">
          {workItem.kind === "task" ? (
            <Link
              href={getTaskWorkspaceHref(workItem.id)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex rounded-full px-4 py-2 text-sm font-medium transition"
            >
              Open execution workspace
            </Link>
          ) : (
            <PromoteToTaskButton workItemId={workItem.id} />
          )}
        </div>

        <p className="text-muted-foreground mt-6 max-w-3xl text-sm leading-7 whitespace-pre-wrap">
          {workItem.description?.trim() || "No description yet."}
        </p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="border-border bg-secondary rounded-3xl border p-6">
          <h2 className="font-display text-foreground text-lg font-semibold">
            Discussion
          </h2>
          <div className="mt-4 space-y-4">
            {comments.length === 0 ? (
              <div className="border-border text-muted-foreground rounded-2xl border border-dashed px-4 py-6 text-sm">
                No comments yet.
              </div>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className="border-border bg-accent rounded-2xl border px-4 py-4"
                >
                  <div className="text-muted-foreground text-xs">
                    {comment.userId}
                  </div>
                  <div className="text-secondary-foreground mt-2 text-sm whitespace-pre-wrap">
                    {comment.body}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-border bg-secondary rounded-3xl border p-6">
          <h2 className="font-display text-foreground text-lg font-semibold">
            Current Artifacts
          </h2>
          <div className="mt-4 space-y-3">
            {currentArtifacts.length === 0 ? (
              <div className="border-border text-muted-foreground rounded-2xl border border-dashed px-4 py-6 text-sm">
                No artifacts attached.
              </div>
            ) : (
              currentArtifacts.map((artifact) => (
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
                </a>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
