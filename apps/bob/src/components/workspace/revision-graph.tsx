"use client";

import { useQuery } from "@tanstack/react-query";

import { cn } from "@bob/ui";
import { Badge } from "@bob/ui/badge";

import { formatRelativeTime } from "~/lib/format/time";
import { useTRPC } from "~/trpc/react";

interface RevisionGraphProps {
  worktreePath: string;
}

export function RevisionGraph({ worktreePath }: RevisionGraphProps) {
  const trpc = useTRPC();

  const { data: isJjRepo, isLoading: checkingRepo } = useQuery(
    trpc.git.jjIsRepo.queryOptions({ path: worktreePath }),
  );

  const {
    data: revisions,
    isLoading: loadingRevisions,
    error,
  } = useQuery({
    ...trpc.git.jjLog.queryOptions({ path: worktreePath, limit: 20 }),
    enabled: isJjRepo === true,
  });

  if (checkingRepo || loadingRevisions) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        Loading revisions...
      </div>
    );
  }

  if (isJjRepo === false) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Git repository — JJ not available
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Failed to load revisions
      </div>
    );
  }

  if (!revisions || revisions.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">No revisions found.</div>
    );
  }

  return (
    <div className="relative space-y-0">
      {revisions.map((rev, i) => {
        const isLast = i === revisions.length - 1;
        const isWorkingCopy = rev.isWorkingCopy;

        return (
          <div key={rev.changeId} className="relative flex gap-3">
            {/* Timeline column */}
            <div className="flex flex-col items-center">
              {/* Node dot */}
              <div
                className={cn(
                  "mt-3 size-3 shrink-0 rounded-full border-2",
                  isWorkingCopy
                    ? "border-primary bg-primary"
                    : "border-border bg-background",
                )}
              />
              {/* Connecting line */}
              {!isLast && <div className="w-px flex-1 bg-border" />}
            </div>

            {/* Revision card */}
            <div
              className={cn(
                "mb-2 flex-1 rounded-lg border p-3",
                isWorkingCopy
                  ? "border-primary/30 bg-primary/5"
                  : "border-border bg-card",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {/* Change ID + badges */}
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {rev.changeId.slice(0, 8)}
                    </span>
                    {isWorkingCopy && (
                      <Badge variant="amber" className="text-[10px]">
                        working copy
                      </Badge>
                    )}
                    {rev.branches.map((branch) => (
                      <Badge
                        key={branch}
                        variant="slate"
                        className="text-[10px]"
                      >
                        {branch}
                      </Badge>
                    ))}
                  </div>

                  {/* Description */}
                  <p
                    className={cn(
                      "mt-1 truncate text-sm",
                      rev.description
                        ? "text-foreground"
                        : "italic text-muted-foreground",
                    )}
                  >
                    {rev.description || "(no description)"}
                  </p>
                </div>

                {/* Age */}
                {rev.timestamp && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(rev.timestamp)}
                  </span>
                )}
              </div>

              {/* Author line */}
              <div className="mt-1 text-xs text-muted-foreground">
                {rev.author}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
