import { notFound } from "next/navigation";

import { PlanningSessionWorkspace } from "~/components/planning/planning-session-workspace";
import { createPlanningClient } from "~/lib/planning/server";

interface PlanningSessionRouteProps {
  params: Promise<{ sessionId: string }>;
}

export const dynamic = "force-dynamic";

export default async function PlanningSessionRoute({
  params,
}: PlanningSessionRouteProps) {
  const { sessionId } = await params;
  const caller = await createPlanningClient();
  const sessionData = await caller("planning.session.get")
    .call({ sessionId })
    .catch(() => null);

  if (!sessionData?.session) {
    notFound();
  }

  return (
    <PlanningSessionWorkspace
      session={{
        id: sessionData.session.id,
        title: sessionData.session.title,
        status: sessionData.session.status,
        workingDirectory: sessionData.session.workingDirectory,
        planningProjectName: sessionData.session.planningProjectName,
        planningSessionType: sessionData.session.planningSessionType,
        workspaceId: sessionData.session.planningWorkspaceId,
      }}
      drafts={(sessionData.drafts ?? []).map((draft) => ({
        id: draft.id,
        title: draft.title,
        status: draft.status,
        priority: draft.priority,
        description: draft.description,
      }))}
    />
  );
}
