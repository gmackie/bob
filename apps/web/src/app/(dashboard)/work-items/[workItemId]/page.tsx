import { notFound } from "next/navigation";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { WorkItemDetailInteractive } from "~/components/work-items/work-item-detail-interactive";
import { WorkflowPageClient } from "./workflow-page-client";
import { createPlanningCaller } from "~/lib/planning/server";

interface WorkItemPageProps {
  params: Promise<{ workItemId: string }>;
}

export const dynamic = "force-dynamic";

export default async function WorkItemPage({ params }: WorkItemPageProps) {
  const { workItemId } = await params;
  const caller = (await createPlanningCaller()) as any;
  let detail;
  try {
    detail = await caller.workItem.get({ id: workItemId });
  } catch (error) {
    console.error(`Failed to fetch work item ${workItemId}:`, error);
    notFound();
  }

  if (!detail) {
    notFound();
  }

  const [comments, requirementData, childItems, featureBranchData, forgeRevisions] = await Promise.all([
    caller.comment.listByWorkItem({ workItemId }),
    caller.requirement.list({ workItemId }).catch(() => ({})),
    caller.workItem
      .list({
        workspaceId: detail.workItem.workspaceId,
        parentId: workItemId,
        limit: 100,
      })
      .catch(() => []),
    // Fetch feature branches (which link to PRs) for this work item
    caller.featureBranch.list({ workItemId }).catch(() => []),
    // Fetch forge revisions (which link to deployments) for this work item
    caller.forgegraph.listRevisions({ taskId: workItemId }).catch(() => []),
  ]);

  // Compute requirement count from grouped data
  const requirementCount = Object.values(requirementData as Record<string, { total: number }>)
    .reduce((sum: number, group) => sum + (group?.total ?? 0), 0);

  // Map child items to the shape expected by WorkflowPage
  const childTasks = (childItems as any[]).map((child: any) => ({
    id: child.id,
    identifier: child.identifier ?? child.id.slice(0, 8),
    title: child.title,
    status: child.status,
    priority: child.priority ?? "no_priority",
  }));

  // Resolve PRs from feature branches — fetch details for each feature PR
  const featureBranches = featureBranchData as any[];
  const prIds = featureBranches
    .map((fb: any) => fb.featurePrId)
    .filter(Boolean) as string[];

  const pullRequestsData = await Promise.all(
    prIds.map((id: string) =>
      caller.pullRequest.get({ pullRequestId: id }).catch(() => null),
    ),
  );

  const pullRequests = pullRequestsData
    .filter(Boolean)
    .map((pr: any) => ({
      id: pr.id,
      number: pr.number ?? 0,
      title: pr.title,
      status: pr.status as string,
      ciPassing: pr.ciPassing ?? false,
      reviewStatus: pr.reviewStatus ?? "pending",
    }));

  // Also fetch task-level PRs from child work items' feature branches
  const childTaskIds = (childItems as any[]).map((c: any) => c.id);
  const childFeatureBranches = await Promise.all(
    childTaskIds.map((id: string) =>
      caller.featureBranch.list({ workItemId: id }).catch(() => []),
    ),
  );
  const childPrIds = childFeatureBranches
    .flat()
    .map((fb: any) => fb.featurePrId)
    .filter(Boolean) as string[];

  const childPRsData = await Promise.all(
    childPrIds.map((id: string) =>
      caller.pullRequest.get({ pullRequestId: id }).catch(() => null),
    ),
  );

  const allPullRequests = [
    ...pullRequests,
    ...childPRsData.filter(Boolean).map((pr: any) => ({
      id: pr.id,
      number: pr.number ?? 0,
      title: pr.title,
      status: pr.status as string,
      ciPassing: pr.ciPassing ?? false,
      reviewStatus: pr.reviewStatus ?? "pending",
    })),
  ];

  // Resolve deployments from forge revisions
  const revisions = forgeRevisions as any[];
  const revisionIds = revisions.map((r: any) => r.id);
  const deploymentsData = await Promise.all(
    revisionIds.map((id: string) =>
      caller.forgegraph.listDeployments({ revisionId: id }).catch(() => []),
    ),
  );

  const allDeployments = deploymentsData.flat().map((d: any) => ({
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
    project: detail.workItem.project
      ? {
          id: detail.workItem.project.id,
          name: detail.workItem.project.name,
          key: detail.workItem.project.key,
        }
      : null,
  };

  const commentsData = comments.map((comment: any) => ({
    id: comment.id,
    body: comment.body,
    userId: comment.userId,
    createdAt: String(comment.createdAt),
  }));

  const artifactsData = detail.currentArtifacts.map((artifact: any) => ({
    id: artifact.id,
    artifactRole: artifact.artifactRole,
    url: artifact.url,
    title: artifact.title ?? null,
  }));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Breadcrumbs
        items={[
          { label: "Planning", href: "/planning" },
          ...(detail.workItem.project
            ? [
                {
                  label: detail.workItem.project.key,
                  href: `/projects/${detail.workItem.project.id}`,
                },
              ]
            : []),
          { label: detail.workItem.identifier },
        ]}
        className="mb-4"
      />

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
        />
      </div>
    </main>
  );
}
