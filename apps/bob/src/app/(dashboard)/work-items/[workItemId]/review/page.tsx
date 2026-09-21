import { notFound } from "next/navigation";
import { createPlanningClient } from "~/lib/planning/server";
import type { BobRpcOutput } from "@gmacko/bob-client/query";
import {
  ReviewPage,
  type ReviewPageProps,
} from "~/components/review/review-page";
import type { CodeReviewData } from "~/components/review/code-review-card";
import type { TestReportData } from "~/components/review/test-report-viewer";
import {
  ArtifactPanel,
  type ArtifactItem,
} from "~/components/review/artifact-panel";
import { OutcomeReadableOutputPanel } from "~/components/work-items/work-item-detail-interactive";

export const dynamic = "force-dynamic";

interface ReviewPageRouteProps {
  params: Promise<{ workItemId: string }>;
}

export default async function ReviewPageRoute({
  params,
}: ReviewPageRouteProps) {
  const { workItemId } = await params;
  const caller = await createPlanningClient();

  // Fetch work item — get takes { id } and returns { workItem, currentArtifacts, childCount }
  const detail = await caller("workItem.get")
    .call({ id: workItemId })
    .catch(() => null);
  if (!detail) return notFound();

  const canonicalId = detail.workItem.id;
  // Filter by task identity before limiting: another task in this project may
  // have a newer batch. A direct dispatch legitimately has no planning batch.
  const batches = await caller("planning.dispatch.listBatches").call({
    workItemId: canonicalId,
    limit: 1,
  });
  const batch = batches[0] ?? null;
  const ownArtifacts = detail.currentArtifacts ?? [];
  const toArtifactItem = (
    a: NonNullable<BobRpcOutput<"workItem.get">>["currentArtifacts"][number],
  ): ArtifactItem => ({
    id: a.id,
    artifactType: a.artifactType ?? a.artifactRole ?? "other",
    artifactRole: a.artifactRole ?? "",
    title: a.title ?? null,
    url: a.url ?? null,
    producerType: a.producerType ?? "system",
    createdAt: a.createdAt ?? "",
  });
  if (!batch) {
    return (
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <h1 className="font-display text-xl font-semibold">
          Execution review · {detail.workItem.title}
        </h1>
        <OutcomeReadableOutputPanel
          workItemId={canonicalId}
          workspaceId={detail.workItem.workspaceId}
        />
        <ArtifactPanel artifacts={ownArtifacts.map(toArtifactItem)} />
      </main>
    );
  }

  const { items } = await caller("planning.dispatch.getBatch").call({
    batchId: batch.id,
    workItemId: canonicalId,
  });
  const childGroups = await caller("workItem.artifact.listChildGroups").call({
    parentWorkItemId: canonicalId,
  });
  const artifactGroups = [
    { workItem: detail.workItem, artifacts: ownArtifacts },
    ...childGroups,
  ];

  // Fetch ForgeGraph data for each item that has progressed past agent
  const revisions: ReviewPageProps["revisions"] = {};
  const codeReviews: Record<string, CodeReviewData> = {};
  const testReports: Record<string, TestReportData> = {};

  await Promise.all(
    items.map(async (item) => {
      if (!item.pipelineState) return;

      // Find revisions for this work item's task
      const revs = await caller("external.forgegraph.listRevisions")
        .call({ taskId: item.planningTaskId, limit: 5 })
        .catch(() => []);

      if (revs.length > 0) {
        const rev = revs[0]!;
        // getRevision requires { repoId, revId } and returns builds, deployments, runEvents
        const fullRev = await caller("external.forgegraph.getRevision")
          .call({ repoId: rev.repoId, revId: rev.revId })
          .catch(() => null);
        if (fullRev) {
          revisions[item.id] = {
            id: fullRev.id,
            revId: fullRev.revId,
            branch: fullRev.branch ?? null,
            gates: [],
            builds: (fullRev.builds ?? []).map((b) => ({
              id: b.id,
              status: b.status,
              ciProvider: b.ciProvider ?? null,
              externalJobId: b.externalJobId ?? null,
              imageDigest: b.imageDigest ?? null,
              durationMs: b.durationMs ?? null,
              createdAt: b.createdAt ?? "",
            })),
          };
        }
      }
    }),
  );

  const rawArtifacts = artifactGroups.flatMap((group) => group.artifacts);
  const allArtifacts: ArtifactItem[] = rawArtifacts.map(toArtifactItem);

  // Parse code review artifacts from their content JSON
  for (const item of items) {
    const group = artifactGroups.find(
      (candidate) =>
        candidate.workItem.id === (item.workItemId ?? item.planningTaskId) ||
        candidate.workItem.externalId === item.planningTaskId,
    );
    const reviewArtifact = group?.artifacts.find(
      (a) =>
        (a.artifactType === "code_review" ||
          a.artifactRole === "code_review") &&
        a.isCurrent &&
        Boolean(item.taskRunId) &&
        a.taskRunId === item.taskRunId,
    );
    if (reviewArtifact?.content) {
      try {
        const parsed = JSON.parse(reviewArtifact.content);
        if (
          parsed?.decision !== "approve" &&
          parsed?.decision !== "request_changes"
        )
          continue;
        codeReviews[item.id] = {
          decision: parsed.decision,
          summary: parsed.summary ?? "",
          comments: Array.isArray(parsed.comments)
            ? parsed.comments.map((c: any) => ({
                file: c.file ?? "",
                line: c.line,
                severity: c.severity ?? "suggestion",
                body: c.body ?? "",
                diffContext: c.diffContext,
                resolution: c.resolution ?? null,
              }))
            : [],
          reviewerName: parsed.reviewerName ?? "bob-reviewer",
          reviewedAt: reviewArtifact.createdAt
            ? String(reviewArtifact.createdAt)
            : undefined,
          iteration: parsed.iteration,
          isAgentFixing: parsed.isAgentFixing ?? false,
        };
      } catch {
        // Content isn't valid JSON, skip
      }
    }
  }

  // Fetch deployments for all revisions
  const deployments = await Promise.all(
    Object.values(revisions).map((rev) =>
      caller("external.forgegraph.listDeployments")
        .call({ revisionId: rev.id })
        .catch(() => []),
    ),
  ).then((results) =>
    results.flat().map((d) => ({
      id: d.id,
      environment: d.environment as string,
      status: d.status as string,
      deployedAt: d.createdAt ? String(d.createdAt) : null,
    })),
  );

  const identifier =
    detail.workItem.identifier ?? `TASK-${detail.workItem.id.slice(0, 8)}`;

  return (
    <ReviewPage
      latestExecution={
        <OutcomeReadableOutputPanel
          workItemId={canonicalId}
          workspaceId={detail.workItem.workspaceId}
        />
      }
      workItemId={canonicalId}
      workItemIdentifier={identifier}
      workItemTitle={detail.workItem.title}
      batchId={batch.id}
      batchStatus={batch.status}
      items={items.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        pipelineState: item.pipelineState ?? null,
        updatedAt: String(item.updatedAt),
      }))}
      revisions={revisions}
      codeReviews={codeReviews}
      testReports={testReports}
      artifacts={allArtifacts}
      deployments={deployments}
    />
  );
}
