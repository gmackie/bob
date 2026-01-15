"use client";

import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

import { CommitList } from "./commit-list";

interface Commit {
  sha: string;
  message: string;
  authorName: string | null;
  authorEmail: string | null;
  committedAt: Date;
  isBobCommit: boolean;
}

interface PullRequest {
  id: string;
  number: number;
  title: string;
  body: string | null;
  status: string;
  url: string;
  headBranch: string;
  baseBranch: string;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  createdAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  commits: Commit[];
}

interface PrTimelineProps {
  pullRequests: PullRequest[];
}

const statusConfig: Record<
  string,
  { label: string; color: string; bgColor: string }
> = {
  draft: {
    label: "Draft",
    color: "text-gray-600",
    bgColor: "bg-gray-100 dark:bg-gray-800",
  },
  open: {
    label: "Open",
    color: "text-green-600",
    bgColor: "bg-green-100 dark:bg-green-900/30",
  },
  merged: {
    label: "Merged",
    color: "text-purple-600",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
  },
  closed: {
    label: "Closed",
    color: "text-red-600",
    bgColor: "bg-red-100 dark:bg-red-900/30",
  },
};

function PrStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? statusConfig.open!;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        config.bgColor,
        config.color,
      )}
    >
      {config.label}
    </span>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

function PrCard({ pr }: { pr: PullRequest }) {
  const bobCommits = pr.commits.filter((c) => c.isBobCommit).length;
  const totalCommits = pr.commits.length;

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm dark:bg-gray-900">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-semibold hover:underline"
            >
              #{pr.number} {pr.title}
            </a>
            <PrStatusBadge status={pr.status} />
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            <span>
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">
                {pr.headBranch}
              </code>
              {" → "}
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs dark:bg-gray-800">
                {pr.baseBranch}
              </code>
            </span>

            {pr.changedFiles !== null && (
              <span>
                {pr.changedFiles} file{pr.changedFiles !== 1 ? "s" : ""} changed
              </span>
            )}

            {(pr.additions !== null || pr.deletions !== null) && (
              <span>
                <span className="text-green-600">+{pr.additions ?? 0}</span>
                {" / "}
                <span className="text-red-600">-{pr.deletions ?? 0}</span>
              </span>
            )}

            <span>{formatDate(pr.createdAt)}</span>
          </div>

          {bobCommits > 0 && (
            <div className="mt-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                {bobCommits} of {totalCommits} commit
                {totalCommits !== 1 ? "s" : ""} by Bob
              </span>
            </div>
          )}
        </div>

        <Button variant="outline" size="sm" asChild>
          <a href={pr.url} target="_blank" rel="noopener noreferrer">
            View PR
          </a>
        </Button>
      </div>

      {pr.commits.length > 0 && (
        <div className="mt-4 border-t pt-4">
          <CommitList commits={pr.commits} maxVisible={3} />
        </div>
      )}
    </div>
  );
}

export function PrTimeline({ pullRequests }: PrTimelineProps) {
  if (pullRequests.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-gray-500">No pull requests yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pullRequests.map((pr) => (
        <PrCard key={pr.id} pr={pr} />
      ))}
    </div>
  );
}
