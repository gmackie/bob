import { notFound } from "next/navigation";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { WorkItemDetailInteractive } from "~/components/work-items/work-item-detail-interactive";
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

  const comments = await caller.comment.listByWorkItem({ workItemId });

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
        <WorkItemDetailInteractive
          workItem={{
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
          }}
          childCount={detail.childCount}
          comments={comments.map((comment: any) => ({
            id: comment.id,
            body: comment.body,
            userId: comment.userId,
            createdAt: String(comment.createdAt),
          }))}
          currentArtifacts={detail.currentArtifacts.map((artifact: any) => ({
            id: artifact.id,
            artifactRole: artifact.artifactRole,
            url: artifact.url,
            title: artifact.title ?? null,
          }))}
        />
      </div>
    </main>
  );
}
