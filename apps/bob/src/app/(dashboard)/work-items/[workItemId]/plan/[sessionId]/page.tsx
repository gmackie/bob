import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { getWorkItemEntryHref } from "~/components/work-items/work-item-entry-model";
import { createPlanningClient } from "~/lib/planning/server";
import { PlanningSessionClient } from "./planning-session-client";

interface PlanningSessionPageProps {
  params: Promise<{ workItemId: string; sessionId: string }>;
  searchParams?: Promise<{ workspace?: string | string[] }>;
}

export const dynamic = "force-dynamic";

export default async function PlanningSessionPage({
  params,
  searchParams,
}: PlanningSessionPageProps) {
  const { workItemId, sessionId } = await params;
  const query = searchParams ? await searchParams : {};
  const caller = await createPlanningClient();

  // Fetch work item and session in parallel
  const [workItemDetail, sessionData, priorArtifacts] = await Promise.all([
    caller("workItem.get")
      .call({ id: workItemId })
      .catch(() => null),
    caller("planning.session.get")
      .call({ sessionId })
      .catch(() => null),
    caller("planning.session.getPriorContext")
      .call({ workItemId, excludeSessionId: sessionId })
      .catch(() => []),
  ]);

  if (!workItemDetail?.workItem.workspaceId) {
    notFound();
  }

  if (!sessionData?.session) {
    // Session not found — redirect to work item
    const selectedWorkspaceId =
      typeof query.workspace === "string" ? query.workspace : null;
    redirect(getWorkItemEntryHref(workItemId, "planning", selectedWorkspaceId));
  }

  const workItem = workItemDetail.workItem;
  const session = sessionData.session;
  const isReadOnly =
    session.status === "stopped" || session.status === "completed";
  const selectedWorkspaceId =
    typeof query.workspace === "string"
      ? query.workspace
      : workItem.workspaceId;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-4 border-b border-border bg-background px-6 py-3">
        <Breadcrumbs
          items={[
            {
              label: "Planning",
              href: selectedWorkspaceId
                ? `/planning?workspace=${encodeURIComponent(selectedWorkspaceId)}`
                : "/planning",
            },
            ...(workItem.project
              ? [
                  {
                    label: workItem.project.key,
                    href: selectedWorkspaceId
                      ? `/projects/${workItem.project.id}?workspace=${encodeURIComponent(selectedWorkspaceId)}`
                      : `/projects/${workItem.project.id}`,
                  },
                ]
              : []),
            {
              label: workItem.identifier,
              href: getWorkItemEntryHref(
                workItemId,
                "planning",
                selectedWorkspaceId,
              ),
            },
            {
              label: session.planningSessionType
                ? formatSessionType(session.planningSessionType)
                : "Planning Session",
            },
          ]}
        />

        {/* Stage badge */}
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          {session.planningSessionType
            ? formatSessionType(session.planningSessionType)
            : "Planning"}
        </span>

        {isReadOnly && (
          <span className="ml-auto text-xs text-muted-foreground">
            Read-only replay
          </span>
        )}
      </div>

      {/* Split-view body */}
      <PlanningSessionClient
        workItem={{
          id: workItem.id,
          identifier: workItem.identifier,
          title: workItem.title,
          description: workItem.description ?? null,
          projectId: workItem.project?.id ?? null,
          projectName: workItem.project?.name ?? null,
          workspaceId: workItemDetail.workItem.workspaceId,
          selectedWorkspaceId,
        }}
        session={{
          id: session.id,
          status: session.status,
          planningSessionType: session.planningSessionType ?? null,
        }}
        priorArtifacts={[...priorArtifacts]}
        isReadOnly={isReadOnly}
      />
    </div>
  );
}

function formatSessionType(type: string): string {
  const map: Record<string, string> = {
    office_hours: "Office Hours",
    ceo_review: "CEO Review",
    eng_review: "Eng Review",
    design_review: "Design Review",
    breakdown: "Breakdown",
  };
  return map[type] ?? type;
}
