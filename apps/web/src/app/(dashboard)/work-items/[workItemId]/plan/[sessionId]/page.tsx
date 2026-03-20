import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "~/components/layout/breadcrumbs";
import { createPlanningCaller } from "~/lib/planning/server";
import { PlanningSessionClient } from "./planning-session-client";

interface PlanningSessionPageProps {
  params: Promise<{ workItemId: string; sessionId: string }>;
}

export const dynamic = "force-dynamic";

export default async function PlanningSessionPage({ params }: PlanningSessionPageProps) {
  const { workItemId, sessionId } = await params;
  const caller = (await createPlanningCaller()) as any;

  // Fetch work item and session in parallel
  const [workItemDetail, sessionData, priorArtifacts] = await Promise.all([
    caller.workItem.get({ id: workItemId }).catch(() => null),
    caller.planSession.get({ sessionId }).catch(() => null),
    caller.planSession.getPriorContext({ workItemId, excludeSessionId: sessionId }).catch(() => []),
  ]);

  if (!workItemDetail) {
    notFound();
  }

  if (!sessionData?.session) {
    // Session not found — redirect to work item
    redirect(`/work-items/${workItemId}`);
  }

  const workItem = workItemDetail.workItem;
  const session = sessionData.session;
  const isReadOnly = session.status === "stopped" || session.status === "completed";

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-4 border-b border-border bg-background px-6 py-3">
        <Breadcrumbs
          items={[
            { label: "Planning", href: "/planning" },
            ...(workItem.project
              ? [{ label: workItem.project.key, href: `/projects/${workItem.project.id}` }]
              : []),
            { label: workItem.identifier, href: `/work-items/${workItemId}` },
            { label: session.planningSessionType
              ? formatSessionType(session.planningSessionType)
              : "Planning Session" },
          ]}
        />

        {/* Stage badge */}
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          {session.planningSessionType
            ? formatSessionType(session.planningSessionType)
            : "Planning"}
        </span>

        {/* End session link (always visible) */}
        {!isReadOnly && (
          <button className="ml-auto text-sm text-muted-foreground hover:text-foreground">
            End session
          </button>
        )}

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
          workspaceId: workItem.workspaceId,
        }}
        session={{
          id: session.id,
          status: session.status,
          planningSessionType: session.planningSessionType,
        }}
        priorArtifacts={priorArtifacts}
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
