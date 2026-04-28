"use client";

import Link from "next/link";

import { cn } from "@bob/ui";

export interface PrListItemProps {
  id: string;
  number: number;
  title: string;
  status: string;
  headBranch: string;
  baseBranch: string;
  remoteOwner: string;
  remoteName: string;
  additions: number | null;
  deletions: number | null;
  createdAt: string;
  mergedAt: string | null;
}

function statusDotColor(status: string): string {
  switch (status) {
    case "open":
    case "draft":
      return "bg-emerald-500";
    case "merged":
      return "bg-purple-500";
    case "closed":
      return "bg-red-500";
    default:
      return "bg-muted-foreground";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "draft":
      return "Draft";
    case "merged":
      return "Merged";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}

function timeAgo(date: string | Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

export function PrListItem({
  id,
  number,
  title,
  status,
  headBranch,
  baseBranch,
  remoteOwner,
  remoteName,
  additions,
  deletions,
  createdAt,
  mergedAt,
}: PrListItemProps) {
  const age = mergedAt ? timeAgo(mergedAt) : timeAgo(createdAt);

  return (
    <Link
      href={`/pull-requests/${id}`}
      className="group flex items-start gap-4 rounded-xl border border-border bg-card px-5 py-4 transition hover:border-muted-foreground/30 hover:shadow-sm"
    >
      {/* Status dot */}
      <span
        className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", statusDotColor(status))}
        title={statusLabel(status)}
      />

      {/* Main content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            #{number}
          </span>
          <h3 className="truncate font-display text-sm font-semibold text-foreground">
            {title}
          </h3>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            {remoteOwner}/{remoteName}
          </span>
          <span className="font-mono">
            {headBranch} &rarr; {baseBranch}
          </span>
          {(additions !== null || deletions !== null) && (
            <span>
              <span className="text-emerald-600 dark:text-emerald-400">
                +{additions ?? 0}
              </span>
              {" / "}
              <span className="text-red-600 dark:text-red-400">
                -{deletions ?? 0}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Right side: status badge + age */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            status === "open" || status === "draft"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : status === "merged"
                ? "bg-purple-500/10 text-purple-700 dark:text-purple-400"
                : "bg-red-500/10 text-red-700 dark:text-red-400",
          )}
        >
          {statusLabel(status)}
        </span>
        <span className="text-[11px] text-muted-foreground">{age}</span>
      </div>
    </Link>
  );
}
