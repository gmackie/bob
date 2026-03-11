"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ExternalLink, FileText, GitPullRequest } from "lucide-react";

import { api } from "@/lib/trpc/client";
import {
  parseForgeRevisionReviewMetadata,
  type ForgeReviewFile,
  type ForgePullRequest,
} from "@/lib/forge/review-data";
import { Button, Badge, Card, CardContent, CardHeader } from "@linear-clone/ui";

import { BuildStatusBadge } from "@/components/forge/build-status-badge";
import { formatDuration } from "@/lib/forge/review-data";

type ForgeBuildCounts = {
  queued: number;
  running: number;
  passed: number;
  failed: number;
  canceled: number;
  superseded: number;
};

function normalizeStatus(status?: string): string {
  return status?.trim() ?? "";
}

function describeFileChange(file: ForgeReviewFile): string {
  const summary: string[] = [];

  if (file.additions !== undefined) {
    summary.push(`+${file.additions}`);
  }

  if (file.deletions !== undefined) {
    summary.push(`-${file.deletions}`);
  }

  if (
    file.changes !== undefined &&
    file.additions === undefined &&
    file.deletions === undefined
  ) {
    summary.push(`${file.changes} lines`);
  }

  return summary.join(" · ");
}

function fileStatusClass(status?: string): string {
  const normalized = normalizeStatus(status).toLowerCase();

  if (["added", "add", "created", "create"].includes(normalized)) {
    return "bg-emerald-500/12 text-emerald-700 border-emerald-500/35";
  }

  if (["removed", "remove", "deleted", "delete"].includes(normalized)) {
    return "bg-red-500/12 text-red-700 border-red-500/35";
  }

  if (["renamed", "moved", "modified", "modify"].includes(normalized)) {
    return "bg-blue-500/12 text-blue-700 border-blue-500/35";
  }

  return "";
}

function summarizeBuildStatuses(builds: { status?: string }[] = []): ForgeBuildCounts {
  return builds.reduce<ForgeBuildCounts>(
    (acc, build) => {
      const status = normalizeStatus(build.status).toLowerCase();
      if (status in acc) {
        acc[status as keyof ForgeBuildCounts] += 1;
      }

      return acc;
    },
    {
      queued: 0,
      running: 0,
      passed: 0,
      failed: 0,
      canceled: 0,
      superseded: 0,
    }
  );
}

export default function ForgeRevisionDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const workspaceSlug = params.workspaceSlug as string;
  const revId = decodeURIComponent(params.revId as string);
  const repoId = searchParams.get("repoId") ?? "";

  const { data: revision, isLoading: revisionLoading } = api.forgeRevision.get.useQuery(
    { repoId, revId },
    { enabled: !!repoId && !!revId }
  );

  const { changedFiles, pullRequests, ciNotes, runId, taskId, agentId } = useMemo(
    () => parseForgeRevisionReviewMetadata(revision?.metadata ?? null),
    [revision?.metadata]
  );

  const { data: runOverlay, isLoading: runLoading } = api.forgeRun.get.useQuery(
    { runId: runId ?? "" },
    { enabled: !!runId }
  );

  const { data: builds, isLoading: buildsLoading } = api.forgeBuild.listByRevision.useQuery(
    { repoId, revId, limit: 10 },
    { enabled: !!repoId && !!revId }
  );
  const buildCounts = summarizeBuildStatuses(builds ?? []);
  type BuildStatus = Parameters<typeof BuildStatusBadge>[0]["status"];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-6 py-4">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Revision Review</h2>
        <h1 className="text-lg font-semibold">Review Change Set</h1>
        <p className="font-mono text-xs text-muted-foreground">/dashboard/{workspaceSlug}/forge</p>
      </div>

      <div className="space-y-6 px-6 py-4">
        <section aria-label="Revision metadata" className="rounded-md border p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <p className="text-sm">
              <span className="text-muted-foreground">Revision:</span> {revId}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Repository:</span> {repoId || "Unknown"}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Change ID:</span> {revision?.changeId || "N/A"}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Indexed:</span>{" "}
              {revision?.indexedAt ? new Date(revision.indexedAt).toLocaleString() : "N/A"}
            </p>
            {(taskId || agentId || runId) ? (
              <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-4">
                <span>Task:</span> {taskId ?? "N/A"}<span className="mx-1">•</span>
                <span>Agent:</span> {agentId ?? "N/A"}<span className="mx-1">•</span>
                <span>Run:</span> {runId ?? "N/A"}
              </p>
            ) : null}
          </div>
        </section>

        <section
          aria-label="Review snapshot"
          className="rounded-md border p-4"
        >
          <h2 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Review Snapshot
          </h2>
          <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <p>
              {changedFiles.length} changed file{changedFiles.length === 1 ? "" : "s"}
            </p>
            <p>
              {pullRequests.length} linked pull request{pullRequests.length === 1 ? "" : "s"}
            </p>
            <p>
              {builds?.length ?? 0} CI build{(builds?.length ?? 0) === 1 ? "" : "s"}
            </p>
            <p>
              {ciNotes.length} CI note{ciNotes.length === 1 ? "" : "s"}
            </p>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold leading-none tracking-tight">
                  Description
                </h2>
              </CardHeader>
              <CardContent>
                {revisionLoading ? (
                  <p className="text-sm text-muted-foreground">Loading revision…</p>
                ) : revision ? (
                  <div className="space-y-3">
                    <p className="text-sm">{revision.description?.trim() || "No description"}</p>
                    <div className="flex flex-wrap gap-2">
                      {(revision.bookmarks ?? []).map((bookmark) => (
                        <Badge key={bookmark} variant="secondary">
                          {bookmark}
                        </Badge>
                      ))}
                    </div>
                    {revision.parentRevIds?.length ? (
                      <p className="text-sm text-muted-foreground">
                        Parent revisions: {revision.parentRevIds.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Revision not found.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold leading-none tracking-tight">
                  Changed Files
                </h2>
              </CardHeader>
              <CardContent>
                {revisionLoading ? (
                  <p className="text-sm text-muted-foreground">Loading changed files…</p>
                ) : changedFiles.length > 0 ? (
                  <ul className="space-y-3">
                    {changedFiles.map((file: ForgeReviewFile) => {
                      const fileStatus = normalizeStatus(file.status);
                      const diffSummary = describeFileChange(file);

                      return (
                        <li key={file.path} className="rounded border p-3">
                          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 space-y-1">
                              <p className="break-all font-mono text-sm">{file.path}</p>
                              {diffSummary ? (
                                <p className="text-xs text-muted-foreground">{diffSummary}</p>
                              ) : null}
                            </div>
                            {fileStatus ? (
                              <Badge
                                className={fileStatusClass(fileStatus)}
                                variant="outline"
                              >
                                {fileStatus}
                              </Badge>
                            ) : null}
                          </div>
                          {file.diff ? (
                            <details className="group">
                              <summary className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:underline">
                                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                                View patch
                              </summary>
                              <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-3 font-mono text-xs leading-5">
                                {file.diff}
                              </pre>
                            </details>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No changed files found.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold leading-none tracking-tight">
                  Related Pull Requests
                </h2>
              </CardHeader>
              <CardContent className="space-y-3">
                {revisionLoading ? (
                  <p className="text-sm text-muted-foreground">Loading PRs…</p>
                ) : pullRequests.length > 0 ? (
                  pullRequests.map((pr: ForgePullRequest) => (
                    <div key={pr.id} className="space-y-2 rounded border p-3">
                      <p className="text-sm font-medium">
                        {pr.title || pr.id}
                        {pr.state ? <span className="text-muted-foreground"> ({pr.state})</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {pr.sourceBranch ? `${pr.sourceBranch} → ${pr.targetBranch ?? "unknown"}` : null}
                        {pr.number ? ` · #${pr.number}` : null}
                      </p>
                      {pr.url ? (
                        <Button asChild size="sm" variant="outline">
                          <a
                            className="inline-flex items-center gap-1"
                            href={pr.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" />
                            Open PR
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground">No PR link available</p>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No linked pull requests.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold leading-none tracking-tight">
                  Run Context
                </h2>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {runLoading ? (
                  <p className="text-sm text-muted-foreground">Loading run context…</p>
                ) : runOverlay ? (
                  <>
                    <p>
                      <span className="text-muted-foreground">Run ID:</span> {runOverlay.runId}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Badge>{runOverlay.status}</Badge>
                      {runOverlay.testStatus ? <Badge variant="secondary">{runOverlay.testStatus}</Badge> : null}
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/dashboard/${workspaceSlug}/forge/runs/${runOverlay.runId}`}>
                        View run detail
                      </Link>
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground">Run ID is not attached to this revision.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold leading-none tracking-tight">
                  CI Results
                </h2>
              </CardHeader>
              <CardContent>
                {buildsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading CI results…</p>
                ) : builds && builds.length > 0 ? (
                  <>
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {buildCounts.passed > 0 ? <Badge>{buildCounts.passed} passed</Badge> : null}
                      {buildCounts.failed > 0 ? <Badge variant="destructive">{buildCounts.failed} failed</Badge> : null}
                      {buildCounts.running > 0 ? (
                        <Badge variant="outline">{buildCounts.running} running</Badge>
                      ) : null}
                      {buildCounts.queued > 0 ? (
                        <Badge variant="outline">{buildCounts.queued} queued</Badge>
                      ) : null}
                      {buildCounts.canceled > 0 ? (
                        <Badge variant="outline">{buildCounts.canceled} canceled</Badge>
                      ) : null}
                      {buildCounts.superseded > 0 ? (
                        <Badge variant="outline">{buildCounts.superseded} superseded</Badge>
                      ) : null}
                    </div>
                    <ul className="space-y-3">
                      {builds.map((build) => (
                        <li key={build.id} className="space-y-2 rounded border p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="break-all font-mono text-xs text-muted-foreground">
                              {build.id}
                            </span>
                            <BuildStatusBadge status={build.status as BuildStatus} />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <p>Provider: {build.ciProvider ?? "unknown"}</p>
                            <p>
                              Started: {build.startedAt ? new Date(build.startedAt).toLocaleString() : "not started"}
                            </p>
                            <p>Duration: {formatDuration(build.startedAt, build.completedAt)}</p>
                            {build.externalJobId ? <p>External job: {build.externalJobId}</p> : null}
                          </div>
                          <Button asChild size="sm" variant="outline">
                            <Link
                              href={`/dashboard/${workspaceSlug}/forge/builds/${build.id}`}
                            >
                              View build
                            </Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No CI results yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold leading-none tracking-tight">
                  CI Notes
                </h2>
              </CardHeader>
              <CardContent>
                {ciNotes.length ? (
                  <ul className="space-y-2 text-sm">
                    {ciNotes.map((note) => (
                      <li key={note} className="rounded border p-2">
                        {note}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No CI notes available.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
