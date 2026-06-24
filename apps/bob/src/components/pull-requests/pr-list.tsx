"use client";

import { useQuery } from "@tanstack/react-query";

import { cn } from "@gmacko/core/ui";

import { useBobRpcClient } from "~/rpc/react";
import { PrListItem } from "./pr-list-item";

type StatusFilter = "open" | "merged" | "closed" | "draft" | undefined;
type PullRequestListItem = {
  id: string;
  number: number | null;
  title: string;
  status: "open" | "merged" | "closed" | "draft";
  headBranch: string;
  baseBranch: string;
  remoteOwner: string | null;
  remoteName: string | null;
  additions: number | null;
  deletions: number | null;
  createdAt: Date | string;
  mergedAt: Date | string | null;
};

interface PrListProps {
  statusFilter?: StatusFilter;
}

export function PrList({ statusFilter }: PrListProps) {
  const rpc = useBobRpcClient();
  const input = { status: statusFilter, limit: 50 };
  const { data: prs, isLoading } = useQuery({
    queryKey: ["rpc", "projects.pullRequest.list", input],
    queryFn: async () =>
      (await rpc.projects.pullRequest.list(input)) as PullRequestListItem[],
    staleTime: 15_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[76px] animate-pulse rounded-xl border border-border bg-card"
          />
        ))}
      </div>
    );
  }

  if (!prs || prs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
        <div className="text-sm text-muted-foreground">
          No pull requests found
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Pull requests created through blder.bot or synced via webhooks will appear
          here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {prs.map((pr) => (
        <PrListItem
          key={pr.id}
          id={pr.id}
          number={pr.number ?? 0}
          title={pr.title}
          status={pr.status}
          headBranch={pr.headBranch}
          baseBranch={pr.baseBranch}
          remoteOwner={pr.remoteOwner ?? "unknown"}
          remoteName={pr.remoteName ?? "unknown"}
          additions={pr.additions}
          deletions={pr.deletions}
          createdAt={
            pr.createdAt instanceof Date
              ? pr.createdAt.toISOString()
              : pr.createdAt
          }
          mergedAt={
            pr.mergedAt instanceof Date
              ? pr.mergedAt.toISOString()
              : pr.mergedAt
          }
        />
      ))}
    </div>
  );
}

export function PrListHeader({
  allCount,
  openCount,
  mergedCount,
  activeFilter,
  onFilterChange,
}: {
  allCount: number;
  openCount: number;
  mergedCount: number;
  activeFilter: StatusFilter;
  onFilterChange: (filter: StatusFilter) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <FilterPill
        label="All"
        count={allCount}
        active={activeFilter === undefined}
        onClick={() => onFilterChange(undefined)}
      />
      <FilterPill
        label="Open"
        count={openCount}
        active={activeFilter === "open"}
        onClick={() => onFilterChange("open")}
      />
      <FilterPill
        label="Merged"
        count={mergedCount}
        active={activeFilter === "merged"}
        onClick={() => onFilterChange("merged")}
      />
    </div>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium transition",
        active
          ? "bg-foreground text-background"
          : "bg-secondary text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <span className="ml-1.5 opacity-60">{count}</span>
    </button>
  );
}
