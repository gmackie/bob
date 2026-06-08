"use client";

import { useState } from "react";

import { cn } from "@gmacko/core/ui";

import { getWorkItemReviewHref } from "~/components/work-items/work-item-entry-model";

interface PullRequest {
  id: string;
  number: number;
  title: string;
  status: string;
  ciPassing: boolean;
  reviewStatus: string;
}

interface StageReviewProps {
  workItemId: string;
  workItem: {
    id: string;
    title: string;
    description: string | null;
    kind: string;
    status: string;
    identifier: string;
    workspaceId?: string | null;
  };
  isCurrentStage: boolean;
  isCompleted: boolean;
  pullRequests: PullRequest[];
}

const PR_STATUS_STYLES: Record<string, string> = {
  open: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  merged: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  closed: "bg-rose-500/15 text-rose-500",
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  pending: "Pending review",
  commented: "Commented",
};

export function StageReview({
  workItemId,
  workItem,
  isCurrentStage,
  isCompleted,
  pullRequests,
}: StageReviewProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isCollapsed = isCompleted && collapsed;

  const totalPRs = pullRequests.length;
  const mergedPRs = pullRequests.filter((pr) => pr.status === "merged").length;
  const openPRs = pullRequests.filter((pr) => pr.status === "open").length;

  const allApprovedAndPassing =
    pullRequests.length > 0 &&
    pullRequests.every(
      (pr) =>
        pr.status === "merged" ||
        (pr.ciPassing && pr.reviewStatus === "approved"),
    );

  return (
    <section
      id="stage-review"
      className="rounded-3xl border border-border bg-card p-6"
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => isCompleted && setCollapsed((c) => !c)}
        className={cn(
          "flex w-full items-center gap-3",
          isCompleted && "cursor-pointer",
        )}
      >
        <h2 className="font-display text-lg font-semibold text-foreground">
          Review
        </h2>

        <span className="text-sm text-muted-foreground">
          {totalPRs} PR{totalPRs !== 1 ? "s" : ""}
          {totalPRs > 0 && (
            <>
              : {mergedPRs} merged, {openPRs} open
            </>
          )}
        </span>

        {isCompleted && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2.5 6L5 8.5L9.5 3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}

        {isCompleted && (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className={cn(
              "ml-auto text-muted-foreground transition-transform",
              isCollapsed && "-rotate-90",
            )}
            aria-hidden="true"
          >
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="mt-4 space-y-3">
          {/* Open Review Dashboard link */}
          <a
            href={getWorkItemReviewHref(workItemId, workItem.workspaceId)}
            className="mb-4 flex items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            Open Review Dashboard →
          </a>

          {pullRequests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No pull requests yet.
            </div>
          ) : (
            <>
              {/* Merge action highlight */}
              {allApprovedAndPassing && isCurrentStage && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-center text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  All PRs approved with CI passing — ready to merge.
                </div>
              )}

              <div className="divide-y divide-border rounded-2xl border border-border">
                {pullRequests.map((pr) => (
                  <div
                    key={pr.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    {/* PR status badge */}
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                        PR_STATUS_STYLES[pr.status] ?? PR_STATUS_STYLES.open,
                      )}
                    >
                      {pr.status}
                    </span>

                    {/* PR number + title */}
                    <span className="font-mono text-xs text-muted-foreground">
                      #{pr.number}
                    </span>
                    <span className="flex-1 truncate text-sm text-foreground">
                      {pr.title}
                    </span>

                    {/* CI indicator */}
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        pr.ciPassing ? "bg-emerald-500" : "bg-rose-500",
                      )}
                      title={pr.ciPassing ? "CI passing" : "CI failing"}
                    />

                    {/* Review status */}
                    <span className="hidden text-xs text-muted-foreground sm:block">
                      {REVIEW_STATUS_LABELS[pr.reviewStatus] ?? pr.reviewStatus}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
