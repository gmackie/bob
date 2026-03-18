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
  const detail = await caller.workItem.get({ id: workItemId });

  if (!detail) {
    notFound();
  }

  const [comments, requirementData, childItems] = await Promise.all([
    caller.comment.listByWorkItem({ workItemId }),
    caller.requirement.list({ workItemId }).catch(() => ({})),
    caller.workItem
      .list({
        workspaceId: detail.workItem.workspaceId,
        parentId: workItemId,
        limit: 100,
      })
      .catch(() => []),
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
          requirements={{ count: requirementCount }}
          childTasks={childTasks}
          comments={commentsData}
          artifacts={artifactsData}
          childCount={detail.childCount}
        />
      </div>
    </main>
  );
}
