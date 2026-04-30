"use client";

import { cn } from "@gmacko/core/ui";

export interface PrHeaderProps {
  number: number;
  title: string;
  status: string;
  headBranch: string;
  baseBranch: string;
  remoteOwner: string;
  remoteName: string;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  createdAt: string;
  mergedAt: string | null;
  url: string;
}

function statusBadgeClasses(status: string): string {
  switch (status) {
    case "open":
    case "draft":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "merged":
      return "bg-purple-500/10 text-purple-700 dark:text-purple-400";
    case "closed":
      return "bg-red-500/10 text-red-700 dark:text-red-400";
    default:
      return "bg-muted text-muted-foreground";
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

export function PrHeader({
  number,
  title,
  status,
  headBranch,
  baseBranch,
  remoteOwner,
  remoteName,
  additions,
  deletions,
  changedFiles,
  createdAt,
  mergedAt,
  url,
}: PrHeaderProps) {
  const age = mergedAt ? timeAgo(mergedAt) : timeAgo(createdAt);

  return (
    <div className="space-y-3">
      {/* Top line: number, badge, branches */}
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="font-mono">#{number}</span>
        <span className="text-border">·</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            statusBadgeClasses(status),
          )}
        >
          {statusLabel(status)}
        </span>
        <span className="text-border">·</span>
        <span className="font-mono text-xs">
          {headBranch} &rarr; {baseBranch}
        </span>
      </div>

      {/* Title */}
      <h1 className="font-display text-2xl font-bold text-foreground">
        {title}
      </h1>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {remoteOwner}/{remoteName}
        </span>
        <span>{age}</span>
        {changedFiles !== null && (
          <span>
            {changedFiles} file{changedFiles !== 1 ? "s" : ""} changed
          </span>
        )}
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
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          View on remote
        </a>
      </div>
    </div>
  );
}
