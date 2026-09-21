import { notFound } from "next/navigation";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { WorkflowPageClient } from "./workflow-page-client";
import { createPlanningClient } from "~/lib/planning/server";
import {
  buildWorkItemEntryContext,
  getWorkItemEntryBreadcrumbs,
  normalizeWorkItemEntryView,
} from "~/components/work-items/work-item-entry-model";

interface WorkItemPageProps {
  params: Promise<{ workItemId: string }>;
  searchParams?: Promise<{ view?: string }>;
}

export const dynamic = "force-dynamic";

export default async function WorkItemPage({
  params,
  searchParams,
}: WorkItemPageProps) {
  const { workItemId } = await params;
  const query = await searchParams;
  const caller = await createPlanningClient();
  let detail;
  try {
    detail = await caller("workItem.get").call({ id: workItemId });
  } catch (error) {
    console.error(`Failed to fetch work item ${workItemId}:`, error);
    notFound();
  }

  if (!detail?.workItem.workspaceId) {
    notFound();
  }

  // Use the resolved UUID for all downstream queries (workItemId from URL may be a short identifier like "BOB-9")
  const resolvedId = detail.workItem.id;

  const [
    comments,
    requirementData,
    childItems,
    featureBranchData,
    forgeRevisions,
  ] = await Promise.all([
    caller("workItem.comment.list").call({ workItemId: resolvedId }),
    caller("workItem.requirement.list")
      .call({ workItemId: resolvedId })
      .catch(() => ({})),
    caller("workItem.list")
      .call({
        workspaceId: detail.workItem.workspaceId,
        parentId: resolvedId,
        limit: 100,
      })
      .catch(() => []),
    // Fetch feature branches (which link to PRs) for this work item
    caller("projects.featureBranch.list")
      .call({ workItemId: resolvedId })
      .catch(() => []),
    // Fetch forge revisions (which link to deployments) for this work item
    caller("external.forgegraph.listRevisions")
      .call({ taskId: resolvedId })
      .catch(() => []),
  ]);

  // Compute requirement count from grouped data
  const requirementCount = Object.values(
    requirementData as Record<string, { total: number }>,
  ).reduce((sum: number, group) => sum + (group?.total ?? 0), 0);

  // Map child items to the shape expected by WorkflowPage
  const childTasks = childItems.map((child) => ({
    id: child.id,
    identifier: child.identifier ?? child.id.slice(0, 8),
    title: child.title,
    status: child.status,
    priority: child.priority ?? "no_priority",
  }));

  // Resolve PRs from feature branches — fetch details for each feature PR
  const featureBranches = featureBranchData;
  const prIds = featureBranches
    .map((fb) => fb.featurePrId)
    .filter((value) => value != null) as string[];

  const pullRequestsData = await Promise.all(
    prIds.map((id: string) =>
      caller("projects.pullRequest.get")
        .call({ pullRequestId: id })
        .catch(() => null),
    ),
  );

  const pullRequests = pullRequestsData
    .filter((value) => value != null)
    .map((pr) => ({
      id: pr.id,
      number: pr.number ?? 0,
      title: pr.title,
      status: pr.status as string,
      ciPassing: false,
      reviewStatus: "pending",
    }));

  // Also fetch task-level PRs from child work items' feature branches
  const childTaskIds = childItems.map((c) => c.id);
  const childFeatureBranches = await Promise.all(
    childTaskIds.map((id: string) =>
      caller("projects.featureBranch.list")
        .call({ workItemId: id })
        .catch(() => []),
    ),
  );
  const childPrIds = childFeatureBranches
    .flat()
    .map((fb) => fb.featurePrId)
    .filter((value) => value != null) as string[];

  const childPRsData = await Promise.all(
    childPrIds.map((id: string) =>
      caller("projects.pullRequest.get")
        .call({ pullRequestId: id })
        .catch(() => null),
    ),
  );

  const allPullRequests = [
    ...pullRequests,
    ...childPRsData
      .filter((value) => value != null)
      .map((pr) => ({
        id: pr.id,
        number: pr.number ?? 0,
        title: pr.title,
        status: pr.status as string,
        ciPassing: false,
        reviewStatus: "pending",
      })),
  ];

  // Resolve deployments from forge revisions
  const revisions = forgeRevisions;
  const revisionIds = revisions.map((r) => r.id);
  const deploymentsData = await Promise.all(
    revisionIds.map((id: string) =>
      caller("external.forgegraph.listDeployments")
        .call({ revisionId: id })
        .catch(() => []),
    ),
  );

  const allDeployments = deploymentsData.flat().map((d) => ({
    id: d.id,
    environment: d.environment as string,
    status: d.status as string,
    deployedAt: d.createdAt ? String(d.createdAt) : undefined,
  }));

  const workItem = {
    id: detail.workItem.id,
    identifier: detail.workItem.identifier,
    title: detail.workItem.title,
    description: detail.workItem.description ?? null,
    kind: detail.workItem.kind,
    status: detail.workItem.status,
    priority: detail.workItem.priority ?? "no_priority",
    agentTypeOverride: detail.workItem.agentTypeOverride ?? null,
    queueSortOrder: detail.workItem.queueSortOrder ?? null,
    workspaceId: detail.workItem.workspaceId,
    agentStatus: detail.workItem.agentStatus ?? null,
    externalProvider: detail.workItem.externalProvider ?? null,
    externalUrl: detail.workItem.externalUrl ?? null,
    dependencies: [...(detail.workItem.dependencies ?? [])],
    dependents: [...(detail.workItem.dependents ?? [])],
    project: detail.workItem.project
      ? {
          id: detail.workItem.project.id,
          name: detail.workItem.project.name,
          key: detail.workItem.project.key,
        }
      : null,
  };
  const entryContext = buildWorkItemEntryContext({
    view: normalizeWorkItemEntryView(query?.view ?? null),
    workspaceId: detail.workItem.workspaceId,
    workItem,
  });
  const breadcrumbs = getWorkItemEntryBreadcrumbs({
    context: entryContext,
    identifier: detail.workItem.identifier,
    project: detail.workItem.project
      ? {
          id: detail.workItem.project.id,
          key: detail.workItem.project.key,
        }
      : null,
    workspaceId: detail.workItem.workspaceId,
  });

  const commentsData = comments.map((comment) => ({
    id: comment.id,
    body: comment.body,
    userId: comment.userId,
    createdAt: String(comment.createdAt),
  }));

  const artifactsData = detail.currentArtifacts.map((artifact) => ({
    id: artifact.id,
    artifactRole: artifact.artifactRole,
    artifactType: artifact.artifactType ?? null,
    url: artifact.url ?? "",
    title: artifact.title ?? null,
    summary: artifact.summary ?? null,
    metadata: artifact.metadata ?? null,
  }));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Breadcrumbs items={breadcrumbs} className="mb-4" />

      <div className="mt-6">
        <WorkflowPageClient
          workItem={workItem}
          workspaceId={detail.workItem.workspaceId}
          requirements={{ count: requirementCount }}
          childTasks={childTasks}
          comments={commentsData}
          artifacts={artifactsData}
          childCount={detail.childCount}
          pullRequests={allPullRequests}
          deployments={allDeployments}
          entryContext={entryContext}
        />
      </div>
    </main>
  );
}
