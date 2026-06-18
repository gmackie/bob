"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { cn } from "@gmacko/core/ui";
import { useTRPC } from "~/trpc/react";

const SESSION_TYPE_LABELS: Record<string, string> = {
  office_hours: "Office Hours",
  ceo_review: "CEO Review",
  eng_review: "Eng Review",
  design_review: "Design Review",
  breakdown: "Breakdown",
};

interface SessionHistoryProps {
  workItemId: string;
  /** Filter to only show sessions of certain types */
  sessionTypes?: string[];
  className?: string;
}

export function SessionHistory({
  workItemId,
  sessionTypes,
  className,
}: SessionHistoryProps) {
  const trpc = useTRPC();

  const { data: sessions, isLoading } = useQuery(
    trpc.planSession.listByWorkItem.queryOptions(
      { workItemId },
      { staleTime: 15_000 },
    ),
  );

  const filtered = sessionTypes
    ? (sessions ?? []).filter((s: any) =>
        sessionTypes.includes(s.planningSessionType),
      )
    : (sessions ?? []);

  if (isLoading) {
    return (
      <div className={cn("space-y-2", className)}>
        {[0, 1].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-lg border border-border p-3"
          >
            <div className="h-4 w-48 rounded bg-muted" />
            <div className="mt-2 h-3 w-24 rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return null; // Don't render empty section — let parent handle empty state
  }

  return (
    <div className={cn("space-y-2", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Sessions
      </h3>
      {filtered.map((session: any) => (
        <div
          key={session.id}
          className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
        >
          {/* Session type icon */}
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <SessionTypeIcon type={session.planningSessionType} />
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {SESSION_TYPE_LABELS[session.planningSessionType] ??
                "Planning Session"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatRelativeDate(session.createdAt)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Link
              href={`/work-items/${workItemId}/plan/${session.id}`}
              className="text-xs text-primary hover:underline"
            >
              {session.status === "stopped" ? "Replay" : "Resume"}
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function SessionTypeIcon({ type }: { type: string | null }) {
  switch (type) {
    case "office_hours":
      return (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z"
          />
        </svg>
      );
    case "ceo_review":
      return (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46"
          />
        </svg>
      );
    case "eng_review":
      return (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z"
          />
        </svg>
      );
    case "design_review":
      return (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z"
          />
        </svg>
      );
    default:
      return (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
          />
        </svg>
      );
  }
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
