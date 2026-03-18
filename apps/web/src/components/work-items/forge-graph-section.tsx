"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { BuildHistory } from "~/components/forgegraph/build-history";
import { DeploymentStatus } from "~/components/forgegraph/deployment-status";
import { GateDecisionCard } from "~/components/forgegraph/gate-decision-card";
import { RevisionStatusBar } from "~/components/forgegraph/revision-status-bar";
import { useLiveBuildStatus } from "~/hooks/use-live-build-status";
import { useTRPC } from "~/trpc/react";

export function ForgeGraphSection({ taskId }: { taskId: string }) {
  const trpc = useTRPC();

  const { latestRevision, builds, deployments, isLoading } =
    useLiveBuildStatus({ taskId });

  const { data: taskRuns } = useQuery({
    ...trpc.taskRun.listByWorkItem.queryOptions({ workItemId: taskId }),
    staleTime: 30_000,
  });

  // Find the latest task run with a linked PR
  const linkedPrId = taskRuns?.find((r) => r.pullRequestId)?.pullRequestId ?? null;

  if (!isLoading && !latestRevision) {
    return (
      <div className="rounded-3xl border border-border bg-secondary p-6">
        <h2 className="font-display text-lg font-semibold text-foreground">Build & Deploy</h2>
        <div className="mt-4 rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No revisions linked to this task.
        </div>
      </div>
    );
  }

  if (!latestRevision) {
    return null;
  }

  const gates = (latestRevision.gates ?? []) as Array<{ name: string; status: "pending" | "passed" | "failed" | "running" }>;

  return (
    <div className="rounded-3xl border border-border bg-secondary p-6">
      <h2 className="font-display text-lg font-semibold text-foreground">Build & Deploy</h2>
      <div className="mt-4 space-y-5">
        <GateDecisionCard gates={gates} available={!!latestRevision.gates} />

        <RevisionStatusBar
          gates={gates}
          commitSha={latestRevision.revId}
          branch={latestRevision.branch ?? undefined}
        />

        {linkedPrId && (
          <Link
            href={`/pull-requests/${linkedPrId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:border-muted-foreground/30 hover:text-foreground"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              className="shrink-0"
              aria-hidden="true"
            >
              <path
                d="M5 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"
                fill="currentColor"
              />
              <path
                d="M3.5 5v6M12.5 5v6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M12.5 5a2 2 0 0 0-2-2h-2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            View PR
          </Link>
        )}

        {builds.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Builds</h3>
            <BuildHistory builds={builds} />
          </div>
        )}

        {deployments.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">
              Deployments
            </h3>
            <DeploymentStatus deployments={deployments} />
          </div>
        )}
      </div>
    </div>
  );
}
