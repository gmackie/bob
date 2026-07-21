"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";

import { ErrorBoundary } from "@gmacko/core/ui/error-boundary";
import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { CiPipeline } from "~/components/pull-requests/ci-pipeline";
import { PrChangedFiles } from "~/components/pull-requests/pr-changed-files";
import { PrHeader } from "~/components/pull-requests/pr-header";
import { PrReviewSection } from "~/components/pull-requests/pr-review-section";
import { useBobRpcClient } from "~/rpc/react";

type PullRequestCommit = {
  sha: string;
  message: string;
  authorName: string | null;
  committedAt: string;
  isBobCommit: boolean;
};

type PullRequestDetail = {
  id: string;
  repositoryId: string | null;
  commits?: PullRequestCommit[];
  number?: number | null;
  remoteNumber?: number | null;
  title: string;
  status: string;
  headBranch: string;
  baseBranch: string;
  remoteOwner?: string | null;
  remoteName?: string | null;
  additions?: number | null;
  deletions?: number | null;
  changedFiles?: number | null;
  createdAt: string;
  mergedAt: string | null;
  url?: string | null;
  remoteUrl?: string | null;
};

type ForgeGraphRevision = {
  builds?: Array<{
    id: string;
    status: string;
    ciProvider?: string | null;
    externalJobId?: string | null;
    durationMs?: number | null;
    createdAt?: Date | string;
  }>;
};

export default function PullRequestDetailPage() {
  const params = useParams<{ prId: string }>();
  const prId = params?.prId ?? "";

  const rpc = useBobRpcClient();
  const pullRequestInput = { pullRequestId: prId };

  const {
    data: pr,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["rpc", "projects.pullRequest.get", pullRequestInput],
    queryFn: async () =>
      (await rpc.projects.pullRequest.get(pullRequestInput)) as PullRequestDetail,
    staleTime: 15_000,
  });

  // Fetch builds if we have a repository and commits with SHAs
  // We look up revision data using the latest commit sha
  const latestCommitSha = pr?.commits?.[0]?.sha;
  const repoId = pr?.repositoryId;
  const revisionInput =
    repoId && latestCommitSha
      ? { repoId, revId: latestCommitSha }
      : undefined;

  const { data: revision } = useQuery({
    queryKey: ["rpc", "external.forgegraph.getRevision", revisionInput],
    queryFn: async () => {
      if (!revisionInput) return null;
      return (await rpc.external.forgegraph.getRevision(
        revisionInput,
      )) as ForgeGraphRevision | null;
    },
    enabled: !!revisionInput,
    staleTime: 30_000,
  });

  const builds = (revision?.builds ?? []).map((b) => ({
    id: b.id,
    status: b.status,
    ciProvider: b.ciProvider ?? null,
    externalJobId: b.externalJobId ?? null,
    durationMs: b.durationMs ?? null,
    createdAt: b.createdAt ?? new Date().toISOString(),
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

  const prNumber = pr.number ?? pr.remoteNumber ?? 0;
  const prUrl = pr.url ?? pr.remoteUrl ?? "#";
  const commits = pr.commits ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Breadcrumbs
        items={[
          { label: "Pull Requests", href: "/pull-requests" },
          { label: `#${prNumber}` },
        ]}
        className="mb-4"
      />

      <PrHeader
        number={prNumber}
        title={pr.title}
        status={pr.status}
        headBranch={pr.headBranch}
        baseBranch={pr.baseBranch}
        remoteOwner={pr.remoteOwner ?? "unknown"}
        remoteName={pr.remoteName ?? "unknown"}
        additions={pr.additions ?? null}
        deletions={pr.deletions ?? null}
        changedFiles={pr.changedFiles ?? null}
        createdAt={pr.createdAt}
        mergedAt={pr.mergedAt}
        url={prUrl}
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
          additions={pr.additions ?? null}
          deletions={pr.deletions ?? null}
          changedFiles={pr.changedFiles ?? null}
          url={prUrl}
          commits={commits}
        />
      </div>
    </main>
  );
}
