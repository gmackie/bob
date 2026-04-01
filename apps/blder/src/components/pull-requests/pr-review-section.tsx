"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { cn } from "@bob/ui";

import { useTRPC } from "~/trpc/react";

interface PrReviewSectionProps {
  pullRequestId: string;
  prStatus: string;
}

const statusLabel: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes Requested",
  commented: "Commented",
};

const statusBorderColor: Record<string, string> = {
  approved: "border-emerald-500/40",
  changes_requested: "border-rose-500/40",
  commented: "border-border",
};

const statusBadgeColor: Record<string, string> = {
  approved:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  changes_requested:
    "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  commented:
    "bg-muted text-muted-foreground",
};

function formatTimestamp(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PrReviewSection({
  pullRequestId,
  prStatus,
}: PrReviewSectionProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: reviews, isLoading } = useQuery(
    trpc.pullRequest.listReviews.queryOptions(
      { pullRequestId },
      { staleTime: 10_000 },
    ),
  );

  const [selectedStatus, setSelectedStatus] = useState<
    "approved" | "changes_requested" | "commented"
  >("approved");
  const [body, setBody] = useState("");

  const addReviewMutation = useMutation(
    trpc.pullRequest.addReview.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.pullRequest.listReviews.queryKey({ pullRequestId }),
        });
        setBody("");
      },
    }),
  );

  const mergeMutation = useMutation(
    trpc.pullRequest.merge.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.pullRequest.get.queryKey({
            pullRequestId,
          }),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.pullRequest.list.queryKey(),
        });
      },
    }),
  );

  const isMerged = prStatus === "merged";
  const isClosed = prStatus === "closed";
  const canMerge = !isMerged && !isClosed;

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <h2 className="font-display text-sm font-semibold text-foreground">
        Reviews
      </h2>

      {/* Review list */}
      {isLoading ? (
        <div className="mt-3 space-y-2">
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : reviews && reviews.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {reviews.map((review) => (
            <li
              key={review.id}
              className={cn(
                "rounded-lg border px-4 py-3",
                statusBorderColor[review.status] ?? "border-border",
              )}
            >
              <div className="flex items-center gap-2">
                {review.userImage && (
                  <img
                    src={review.userImage}
                    alt=""
                    className="h-5 w-5 rounded-full"
                  />
                )}
                <span className="text-sm font-medium text-foreground">
                  {review.userName ?? "Unknown"}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    statusBadgeColor[review.status] ?? "bg-muted text-muted-foreground",
                  )}
                >
                  {statusLabel[review.status] ?? review.status}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatTimestamp(review.createdAt)}
                </span>
              </div>
              {review.body && (
                <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
                  {review.body}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          No reviews yet.
        </p>
      )}

      {/* Add review form */}
      {canMerge && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="text-sm font-medium text-foreground">Add Review</h3>

          <div className="mt-3 flex gap-3">
            {(
              [
                ["approved", "Approve"],
                ["changes_requested", "Request Changes"],
                ["commented", "Comment"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  selectedStatus === value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <input
                  type="radio"
                  name="review-status"
                  value={value}
                  checked={selectedStatus === value}
                  onChange={() => setSelectedStatus(value)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Leave a comment..."
            rows={3}
            className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                addReviewMutation.mutate({
                  pullRequestId,
                  status: selectedStatus,
                  body: body || undefined,
                })
              }
              disabled={addReviewMutation.isPending}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {addReviewMutation.isPending ? "Submitting..." : "Submit Review"}
            </button>
          </div>
        </div>
      )}

      {/* Merge buttons */}
      {canMerge && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                mergeMutation.mutate({
                  pullRequestId,
                  mergeMethod: "merge",
                })
              }
              disabled={mergeMutation.isPending}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {mergeMutation.isPending ? "Merging..." : "Merge pull request"}
            </button>
            <button
              type="button"
              onClick={() =>
                mergeMutation.mutate({
                  pullRequestId,
                  mergeMethod: "squash",
                })
              }
              disabled={mergeMutation.isPending}
              className="rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Squash and merge
            </button>
          </div>
          {mergeMutation.isError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">
              {mergeMutation.error.message}
            </p>
          )}
        </div>
      )}

      {isMerged && (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            This pull request has been merged.
          </p>
        </div>
      )}
    </div>
  );
}
