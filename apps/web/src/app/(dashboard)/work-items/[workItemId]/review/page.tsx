import { notFound } from "next/navigation";
import { createPlanningCaller } from "~/lib/planning/server";
import { ReviewPage } from "~/components/review/review-page";
import type { CodeReviewData } from "~/components/review/code-review-card";
import type { TestReportData } from "~/components/review/test-report-viewer";
import type { BuildData } from "~/components/review/build-detail-card";
import type { Gate } from "~/components/review/gate-row";
import type { ArtifactItem } from "~/components/review/artifact-panel";

export const dynamic = "force-dynamic";

interface ReviewPageRouteProps {
  params: Promise<{ workItemId: string }>;
}

export default async function ReviewPageRoute({ params }: ReviewPageRouteProps) {
  const { workItemId } = await params;
  const caller = (await createPlanningCaller()) as any;

  // Fetch work item — get takes { id } and returns { workItem, currentArtifacts, childCount }
  const detail = await caller.workItem.get({ id: workItemId }).catch(() => null);
  if (!detail) return notFound();

  // Find dispatch batch for this work item.
  // listBatches returns the current user's batches ordered by most recent.
  // We match by projectId since batches are scoped to a project.
  const batches = await caller.dispatch.listBatches({ limit: 10 }).catch(() => []);
  const batch = (batches as any[]).find(
    (b: any) => b.projectId === detail.workItem.project?.id,
  );
  if (!batch) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No dispatch batch found for this work item. Start execution from the workflow page.
        </div>
      </main>
    );
  }

  // Fetch batch with items
  const batchData = await caller.dispatch.getBatch({ batchId: batch.id });
  const { items } = batchData;

  // Fetch ForgeGraph data for each item that has progressed past agent
  const revisions: Record<string, any> = {};
  const codeReviews: Record<string, CodeReviewData> = {};
  const testReports: Record<string, TestReportData> = {};

  await Promise.all(
    (items as any[]).map(async (item: any) => {
      if (!item.pipelineState) return;

      // Find revisions for this work item's task
      const revs = await caller.forgegraph
        .listRevisions({ taskId: item.planningTaskId, limit: 5 })
        .catch(() => []);

      if (revs.length > 0) {
        const rev = revs[0];
        // getRevision requires { repoId, revId } and returns builds, deployments, runEvents
        const fullRev = await caller.forgegraph
          .getRevision({ repoId: rev.repoId, revId: rev.revId })
          .catch(() => null);
        if (fullRev) {
          revisions[item.id] = {
            id: fullRev.id,
            revId: fullRev.revId,
            branch: fullRev.branch,
            gates: [] as Gate[], // Gates are derived from run events, not a separate field
            builds: ((fullRev.builds ?? []) as any[]).map((b: any) => ({
              id: b.id,
              status: b.status,
              ciProvider: b.ciProvider,
              externalJobId: b.externalJobId,
              imageDigest: b.imageDigest,
              durationMs: b.durationMs ?? null,
              createdAt: b.createdAt,
            })) as BuildData[],
          };
        }
      }
    }),
  );

  // Artifacts come from the workItem.get response (detail.currentArtifacts)
  const allArtifacts: ArtifactItem[] = ((detail.currentArtifacts ?? []) as any[]).map(
    (a: any) => ({
      id: a.id,
      artifactType: a.artifactType ?? a.artifactRole ?? "other",
      artifactRole: a.artifactRole ?? "",
      title: a.title ?? null,
      url: a.url ?? null,
      producerType: a.producerType ?? "system",
      createdAt: a.createdAt ?? new Date().toISOString(),
    }),
  );

  // Parse code review artifacts
  for (const item of items as any[]) {
    const reviewArtifact = allArtifacts.find(
      (a) => a.artifactType === "code_review",
    );
    if (reviewArtifact) {
      try {
        // Code review content would be parsed from artifact — placeholder for now
        codeReviews[item.id] = {
          decision: "approve",
          summary: "Review passed.",
          comments: [],
          reviewerName: "bob-reviewer",
        };
      } catch {
        // Skip unparseable reviews
      }
    }
  }

  // Fetch deployments for all revisions
  const deployments = await Promise.all(
    Object.values(revisions).map((rev: any) =>
      caller.forgegraph.listDeployments({ revisionId: rev.id }).catch(() => []),
    ),
  ).then((results: any[][]) =>
    results.flat().map((d: any) => ({
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
      workItemId={workItemId}
      workItemIdentifier={identifier}
      workItemTitle={detail.workItem.title}
      batchId={batch.id}
      batchStatus={batch.status}
      items={(items as any[]).map((item: any) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        pipelineState: item.pipelineState,
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
