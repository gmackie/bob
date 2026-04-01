"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";
import { Input } from "@bob/ui/input";
import { toast } from "@bob/ui/toast";

import { useTRPC } from "~/trpc/react";

/* -------------------------------------------------------------------------- */
/*  Props                                                                     */
/* -------------------------------------------------------------------------- */

interface FeatureBranchViewProps {
  workItemId: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

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

function branchStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "ready":
      return "Ready";
    case "merged":
      return "Merged";
    case "abandoned":
      return "Abandoned";
    default:
      return status;
  }
}

function branchStatusColor(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "ready":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "merged":
      return "bg-purple-500/10 text-purple-700 dark:text-purple-400";
    case "abandoned":
      return "bg-red-500/10 text-red-700 dark:text-red-400";
    default:
      return "bg-muted-foreground/10 text-muted-foreground";
  }
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                            */
/* -------------------------------------------------------------------------- */

export function FeatureBranchView({ workItemId }: FeatureBranchViewProps) {
  const trpc = useTRPC();
  const router = useRouter();

  const { data: branches, isLoading } = useQuery(
    trpc.featureBranch.list.queryOptions(
      { workItemId },
      { staleTime: 15_000 },
    ),
  );

  // Pick the first active (or most recent) feature branch
  const activeBranch = branches?.find((b) => b.status === "active") ?? branches?.[0];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Loading feature branches...
      </div>
    );
  }

  if (!branches || branches.length === 0) {
    return <EmptyState workItemId={workItemId} />;
  }

  if (!activeBranch) return null;

  return (
    <FeatureBranchDetail
      branchId={activeBranch.id}
      branchName={activeBranch.branchName}
      baseBranch={activeBranch.baseBranch}
      status={activeBranch.status}
      featurePrId={activeBranch.featurePrId}
      repositoryId={activeBranch.repositoryId}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty State                                                               */
/* -------------------------------------------------------------------------- */

function EmptyState({ workItemId }: { workItemId: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [branchName, setBranchName] = useState("");
  const [showForm, setShowForm] = useState(false);

  // We need a repositoryId — fetch available repos
  // For now use a simple text input; a real implementation would use a repo picker
  const [repositoryId, setRepositoryId] = useState("");

  const createBranch = useMutation(
    trpc.featureBranch.create.mutationOptions({
      onSuccess: () => {
        toast("Feature branch created");
        router.refresh();
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  if (!showForm) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border px-6 py-10">
        <div className="text-center">
          <h3 className="font-display text-sm font-semibold text-foreground">
            No feature branch yet
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a feature branch to organize task PRs with a two-tier merge
            model.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowForm(true)}
        >
          Create feature branch
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-accent p-4">
      <h3 className="font-display text-sm font-semibold text-foreground">
        New feature branch
      </h3>
      <div className="space-y-2">
        <Input
          placeholder="Branch name (e.g. feat/my-feature)"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
        />
        <Input
          placeholder="Repository ID"
          value={repositoryId}
          onChange={(e) => setRepositoryId(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!branchName || !repositoryId || createBranch.isPending}
          onClick={() =>
            createBranch.mutate({
              workItemId,
              branchName,
              repositoryId,
            })
          }
        >
          {createBranch.isPending ? "Creating..." : "Create"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowForm(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Feature Branch Detail (Two-Tier View)                                     */
/* -------------------------------------------------------------------------- */

interface FeatureBranchDetailProps {
  branchId: string;
  branchName: string;
  baseBranch: string;
  status: string;
  featurePrId: string | null;
  repositoryId: string;
}

function FeatureBranchDetail({
  branchId,
  branchName,
  baseBranch,
  status,
  featurePrId,
  repositoryId,
}: FeatureBranchDetailProps) {
  const trpc = useTRPC();
  const router = useRouter();

  const { data: branchDetail } = useQuery(
    trpc.featureBranch.get.queryOptions(
      { id: branchId },
      { staleTime: 15_000 },
    ),
  );

  const createFeaturePR = useMutation(
    trpc.featureBranch.createFeaturePR.mutationOptions({
      onSuccess: () => {
        toast("Feature PR created");
        router.refresh();
      },
      onError: (err) => {
        toast(err.message, {
          style: { background: "#1a0000", borderColor: "#f43f5e40" },
        });
      },
    }),
  );

  const taskPRs = branchDetail?.taskPRs ?? [];
  const featurePr = branchDetail?.featurePrId ? branchDetail.featurePrId : featurePrId;

  return (
    <div className="space-y-0">
      {/* Branch header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Feature Branch
        </h2>
        <span className="font-mono text-sm text-muted-foreground">
          {branchName}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            branchStatusColor(status),
          )}
        >
          {branchStatusLabel(status)}
        </span>
      </div>

      {/* Tier 1: Task PRs */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400">
            Tier 1
          </span>
          <span className="text-sm font-medium text-foreground">Task PRs</span>
          <span className="text-xs text-muted-foreground">
            Individual task branches merge into the feature branch
          </span>
        </div>

        {taskPRs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No task PRs linked yet. Task PRs targeting{" "}
            <span className="font-mono text-xs">{branchName}</span> will appear
            here.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {taskPRs.map((taskPR) => (
              <TaskPRCard
                key={taskPR.id}
                taskPR={taskPR}
              />
            ))}
          </div>
        )}
      </div>

      {/* Arrow connector */}
      <div className="flex flex-col items-center gap-1 py-4">
        <div className="h-6 w-px bg-border" />
        <div className="flex items-center gap-2 rounded-full border border-border bg-accent px-3 py-1">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className="text-muted-foreground"
            aria-hidden="true"
          >
            <path
              d="M6 2v8M3 7l3 3 3-3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[11px] text-muted-foreground">
            merge into feature branch
          </span>
        </div>
        <div className="h-6 w-px bg-border" />
      </div>

      {/* Tier 2: Feature PR */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Tier 2
          </span>
          <span className="text-sm font-medium text-foreground">
            Feature PR
          </span>
          <span className="text-xs text-muted-foreground">
            Feature branch merges into {baseBranch}
          </span>
        </div>

        {featurePr ? (
          <FeaturePRCard
            featurePrId={featurePr}
            branchName={branchName}
            baseBranch={baseBranch}
            taskPRCount={taskPRs.length}
            mergedTaskPRCount={taskPRs.filter((t) => t.mergedAt).length}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-accent px-5 py-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                No feature PR exists yet. Create one to merge{" "}
                <span className="font-mono text-xs">{branchName}</span> into{" "}
                <span className="font-mono text-xs">{baseBranch}</span>.
              </p>
              <Button
                size="sm"
                disabled={createFeaturePR.isPending}
                onClick={() =>
                  createFeaturePR.mutate({
                    featureBranchId: branchId,
                    title: `Feature: ${branchName}`,
                    repositoryId,
                  })
                }
              >
                {createFeaturePR.isPending
                  ? "Creating..."
                  : "Create Feature PR"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Task PR Card                                                              */
/* -------------------------------------------------------------------------- */

interface TaskPRCardProps {
  taskPR: {
    id: string;
    mergedAt: Date | null;
    pullRequest: {
      id: string;
      number: number;
      title: string;
      status: string;
      headBranch: string;
      baseBranch: string;
      additions: number | null;
      deletions: number | null;
    } | null;
  };
}

function TaskPRCard({ taskPR }: TaskPRCardProps) {
  const pr = taskPR.pullRequest;
  if (!pr) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        PR data unavailable
      </div>
    );
  }

  const isMerged = !!taskPR.mergedAt || pr.status === "merged";

  return (
    <Link
      href={`/pull-requests/${pr.id}`}
      className="group flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 transition hover:border-muted-foreground/30 hover:shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          #{pr.number}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            isMerged
              ? "bg-purple-500/10 text-purple-700 dark:text-purple-400"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          )}
        >
          {isMerged ? "Merged" : statusLabel(pr.status)}
        </span>
      </div>
      <h4 className="truncate text-sm font-medium text-foreground">
        {pr.title}
      </h4>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate font-mono">
          {pr.headBranch} &rarr; {pr.baseBranch}
        </span>
        {(pr.additions !== null || pr.deletions !== null) && (
          <span className="shrink-0">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{pr.additions ?? 0}
            </span>
            {" / "}
            <span className="text-red-600 dark:text-red-400">
              -{pr.deletions ?? 0}
            </span>
          </span>
        )}
      </div>
      {/* CI check indicator */}
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "size-2 rounded-full",
            isMerged
              ? "bg-purple-500"
              : pr.status === "open"
                ? "bg-emerald-500"
                : "bg-muted-foreground",
          )}
        />
        <span className="text-[11px] text-muted-foreground">
          {isMerged ? "Merged into feature" : "CI passing"}
        </span>
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  Feature PR Card                                                           */
/* -------------------------------------------------------------------------- */

interface FeaturePRCardProps {
  featurePrId: string;
  branchName: string;
  baseBranch: string;
  taskPRCount: number;
  mergedTaskPRCount: number;
}

function FeaturePRCard({
  featurePrId,
  branchName,
  baseBranch,
  taskPRCount,
  mergedTaskPRCount,
}: FeaturePRCardProps) {
  return (
    <Link
      href={`/pull-requests/${featurePrId}`}
      className="group flex flex-col gap-3 rounded-2xl border border-border bg-card px-5 py-4 transition hover:border-muted-foreground/30 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="truncate font-display text-base font-semibold text-foreground">
            Feature: {branchName}
          </h4>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {branchName} &rarr; {baseBranch}
          </div>
        </div>
        <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
          Feature PR
        </span>
      </div>

      {/* Combined stats */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span>
          {mergedTaskPRCount}/{taskPRCount} task PRs merged
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-2 rounded-full",
              mergedTaskPRCount === taskPRCount && taskPRCount > 0
                ? "bg-emerald-500"
                : "bg-amber-500",
            )}
          />
          <span>
            {mergedTaskPRCount === taskPRCount && taskPRCount > 0
              ? "All tasks merged"
              : "Tasks in progress"}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      {taskPRCount > 0 && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-amber-500 transition-all"
            style={{
              width: `${Math.round((mergedTaskPRCount / taskPRCount) * 100)}%`,
            }}
          />
        </div>
      )}
    </Link>
  );
}
