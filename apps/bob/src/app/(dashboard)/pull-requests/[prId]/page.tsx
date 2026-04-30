"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";

import { ErrorBoundary } from "@gmacko/core/ui/error-boundary";
import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { CiPipeline } from "~/components/pull-requests/ci-pipeline";
import { PrChangedFiles } from "~/components/pull-requests/pr-changed-files";
import { PrHeader } from "~/components/pull-requests/pr-header";
import { PrReviewSection } from "~/components/pull-requests/pr-review-section";
import { useTRPC } from "~/trpc/react";

export default function PullRequestDetailPage() {
  const params = useParams<{ prId: string }>();
  const prId = params?.prId ?? "";

  const trpc = useTRPC();

  const {
    data: pr,
    isLoading,
    error,
  } = useQuery(
    trpc.pullRequest.get.queryOptions(
      { pullRequestId: prId },
      { staleTime: 15_000 },
    ),
  );

  // Fetch builds if we have a repository and commits with SHAs
  // We look up revision data using the latest commit sha
  const latestCommitSha = pr?.commits?.[0]?.sha;
  const repoId = pr?.repositoryId;

  const { data: revision } = useQuery(
    trpc.forgegraph.getRevision.queryOptions(
      { repoId: repoId!, revId: latestCommitSha! },
      {
        enabled: !!repoId && !!latestCommitSha,
        staleTime: 30_000,
      },
    ),
  );

  const builds = (revision?.builds ?? []).map((b) => ({
    id: b.id,
    status: b.status,
    ciProvider: b.ciProvider,
    externalJobId: b.externalJobId,
    durationMs: b.durationMs,
    createdAt: b.createdAt,
  }));

  if (isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-48 rounded bg-muted" />
          <div className="h-8 w-96 rounded bg-muted" />
          <div className="h-4 w-64 rounded bg-muted" />
        </div>
      </main>
    );
  }

  if (error || !pr) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Breadcrumbs
          items={[
            { label: "Pull Requests", href: "/pull-requests" },
            { label: "Not Found" },
          ]}
          className="mb-4"
        />
        <div className="rounded-xl border border-border bg-card px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {error?.message ?? "Pull request not found."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Breadcrumbs
        items={[
          { label: "Pull Requests", href: "/pull-requests" },
          { label: `#${pr.number}` },
        ]}
        className="mb-4"
      />

      <PrHeader
        number={pr.number}
        title={pr.title}
        status={pr.status}
        headBranch={pr.headBranch}
        baseBranch={pr.baseBranch}
        remoteOwner={pr.remoteOwner}
        remoteName={pr.remoteName}
        additions={pr.additions}
        deletions={pr.deletions}
        changedFiles={pr.changedFiles}
        createdAt={pr.createdAt}
        mergedAt={pr.mergedAt}
        url={pr.url}
      />

      <div className="mt-6 space-y-4">
        <ErrorBoundary section="CI Pipeline">
          <CiPipeline builds={builds} />
        </ErrorBoundary>

        <ErrorBoundary section="Reviews">
          <PrReviewSection
            pullRequestId={pr.id}
            prStatus={pr.status}
          />
        </ErrorBoundary>

        <PrChangedFiles
          additions={pr.additions}
          deletions={pr.deletions}
          changedFiles={pr.changedFiles}
          url={pr.url}
          commits={pr.commits}
        />
      </div>
    </main>
  );
}
