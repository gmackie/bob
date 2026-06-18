"use client";

import { formatRelativeTime } from "~/lib/format/time";
import { useLiveActivity } from "~/hooks/use-live-activity";

/** Map activity type to a Tailwind dot color. */
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
    case "agent_completed":
      return "bg-emerald-500";
    case "build_failed":
    case "deploy_failed":
    case "agent_failed":
      return "bg-rose-500";
    case "pr_created":
    case "pr_merged":
      return "bg-purple-500";
    default:
      return "bg-muted-foreground";
  }
}

/** Human-readable event description. */
function eventDescription(activity: {
  type: string;
  fromValue?: string | null;
  toValue?: string | null;
}): string {
  switch (activity.type) {
    case "status_changed": {
      const from = activity.fromValue;
      const to = activity.toValue;
      if (from && to)
        return `Status changed from ${fmt(from)} to ${fmt(to)}`;
      if (to) return `Status set to ${fmt(to)}`;
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
    case "agent_completed":
      return "Agent run completed";
    case "agent_failed":
      return "Agent run failed";
    case "deploy_completed":
      return "Deploy completed";
    case "deploy_failed":
      return "Deploy failed";
    case "pr_created":
      return "Pull request created";
    case "pr_merged":
      return "Pull request merged";
    default:
      return activity.type
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function fmt(value: string): string {
  return value.replace(/_/g, " ");
}

export function ActivityFeed({ workspaceId }: { workspaceId?: string }) {
  const { workspaceActivities: activities, isLoading } = useLiveActivity({
    workspaceId,
    limit: 50,
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h3 className="font-display text-sm font-semibold text-foreground">
        Recent Activity
      </h3>

      {isLoading ? (
        <div className="mt-3 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      ) : !activities || activities.length === 0 ? (
        <p className="mt-3 font-body text-sm text-muted-foreground">
          No recent activity
        </p>
      ) : (
        <div className="mt-3 max-h-[28rem] space-y-0 overflow-y-auto">
          {activities.map((activity, index) => {
            const isLast = index === activities.length - 1;

            return (
              <div key={activity.id} className="relative flex gap-3 pb-3">
                {/* Vertical connector */}
                {!isLast && (
                  <span
                    className="absolute left-[5px] top-3 bottom-0 w-px bg-border"
                    aria-hidden="true"
                  />
                )}

                {/* Colored dot */}
                <span
                  className={`relative mt-1.5 size-[10px] shrink-0 rounded-full border-2 border-card ${dotColor(activity.type)}`}
                  aria-hidden="true"
                />

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">
                    {eventDescription(activity)}
                  </p>
                  <div className="flex items-center gap-2">
                    {activity.workItemIdentifier && (
                      <a
                        href={`/work-items/${activity.workItemId}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {activity.workItemIdentifier}
                      </a>
                    )}
                    {activity.workItemTitle && (
                      <span className="truncate text-xs text-muted-foreground">
                        {activity.workItemTitle}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(activity.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
