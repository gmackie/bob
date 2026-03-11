"use client";

import { useState } from "react";

import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

interface Commit {
  sha: string;
  message: string;
  authorName: string | null;
  authorEmail: string | null;
  committedAt: Date;
  isBobCommit: boolean;
}

interface CommitListProps {
  commits: Commit[];
  maxVisible?: number;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function CommitRow({ commit }: { commit: Commit }) {
  const firstLine = commit.message.split("\n")[0] ?? "";
  const shortSha = commit.sha.slice(0, 7);

  return (
    <div className="flex items-center gap-3 py-2">
      <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
        {shortSha}
      </code>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" title={commit.message}>
          {firstLine}
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        {commit.isBobCommit && (
          <span className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
            Bob
          </span>
        )}
        <span className="whitespace-nowrap">
          {commit.authorName ?? "Unknown"}
        </span>
        <span className="whitespace-nowrap">
          {formatRelativeTime(commit.committedAt)}
        </span>
      </div>
    </div>
  );
}

export function CommitList({ commits, maxVisible = 5 }: CommitListProps) {
  const [expanded, setExpanded] = useState(false);

  if (commits.length === 0) {
    return <p className="text-sm text-gray-500">No commits</p>;
  }

  const visibleCommits = expanded ? commits : commits.slice(0, maxVisible);
  const hasMore = commits.length > maxVisible;

  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        Commits ({commits.length})
      </h4>

      <div className="divide-y">
        {visibleCommits.map((commit) => (
          <CommitRow key={commit.sha} commit={commit} />
        ))}
      </div>

      {hasMore && (
        <div className="mt-2 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? "Show less"
              : `Show ${commits.length - maxVisible} more commit${commits.length - maxVisible !== 1 ? "s" : ""}`}
          </Button>
        </div>
      )}
    </div>
  );
}
