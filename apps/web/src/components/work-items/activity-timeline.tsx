"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { formatRelativeTime } from "~/lib/format/time";
import { useTRPC } from "~/trpc/react";

/** Map activity type to a Tailwind color class for the dot. */
function dotColor(type: string): string {
  switch (type) {
    case "status_changed":
      return "bg-amber-500";
    case "comment_added":
      return "bg-muted-foreground";
    case "build_started":
    case "build_running":
      return "bg-blue-500";
    case "build_passed":
    case "deploy_completed":
      return "bg-emerald-500";
    case "build_failed":
    case "deploy_failed":
      return "bg-rose-500";
    case "pr_created":
    case "pr_merged":
      return "bg-purple-500";
    default:
      return "bg-muted-foreground";
  }
}

/** Human-readable event title derived from the activity type and metadata. */
function eventTitle(activity: {
  type: string;
  fromValue?: string | null;
  toValue?: string | null;
  metadata?: Record<string, unknown> | null;
}): string {
  switch (activity.type) {
    case "status_changed": {
      const from = activity.fromValue;
      const to = activity.toValue;
      if (from && to) return `Status changed from ${format(from)} to ${format(to)}`;
      if (to) return `Status set to ${format(to)}`;
      return "Status changed";
    }
    case "comment_added":
      return "Comment added";
    case "artifact_added":
      return "Artifact added";
    case "notification_created":
      return "Notification created";
    case "build_started":
      return "Build started";
    case "build_running":
      return "Build running";
    case "build_passed":
      return "Build passed";
    case "build_failed":
      return "Build failed";
    case "deploy_completed":
      return "Deploy completed";
    case "deploy_failed":
      return "Deploy failed";
    case "pr_created":
      return "Pull request created";
    case "pr_merged":
      return "Pull request merged";
    default:
      return activity.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function format(value: string): string {
  return value.replace(/_/g, " ");
}

const COLLAPSED_LIMIT = 10;

interface ActivityTimelineProps {
  workItemId: string;
}

export function ActivityTimeline({ workItemId }: ActivityTimelineProps) {
  const trpc = useTRPC();
  const [expanded, setExpanded] = useState(false);

  const { data: activities, isLoading } = useQuery({
    ...trpc.activity.listByWorkItem.queryOptions({
      workItemId,
      limit: 100,
    }),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        Loading activity...
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No activity yet.
      </div>
    );
  }

  const visible = expanded ? activities : activities.slice(0, COLLAPSED_LIMIT);
  const hasMore = activities.length > COLLAPSED_LIMIT;

  return (
    <div>
      <ol className="relative space-y-0">
        {visible.map((activity, index) => {
          const isLast = index === visible.length - 1;

          return (
            <li key={activity.id} className="relative flex gap-3 pb-4">
              {/* Vertical line */}
              {!isLast && (
                <span
                  className="absolute left-[5px] top-3 bottom-0 w-px bg-border"
                  aria-hidden="true"
                />
              )}

              {/* Dot */}
              <span
                className={`relative mt-1.5 size-[10px] shrink-0 rounded-full border-2 border-card ${dotColor(activity.type)}`}
                aria-hidden="true"
              />

              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">
                  {eventTitle(activity)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(activity.createdAt)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {hasMore && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          Show all ({activities.length})
        </button>
      )}
    </div>
  );
}
