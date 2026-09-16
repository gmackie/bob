import { notFound } from "next/navigation";

import { ExecutionSessionWorkspace } from "~/components/sessions/execution-session-workspace";
import { createPlanningClient } from "~/lib/planning/server";

interface ExecutionSessionRouteProps {
  params: Promise<{ sessionId: string }>;
}

export const dynamic = "force-dynamic";

export default async function ExecutionSessionRoute({
  params,
}: ExecutionSessionRouteProps) {
  const { sessionId } = await params;
  const caller = await createPlanningClient();
  const session = await caller("agent.session.get")
    .call({ id: sessionId })
    .catch(() => null);

  if (!session) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <ExecutionSessionWorkspace
        session={{
          id: session.id,
          title: session.title,
          status: session.status,
          agentType: session.agentType,
          workingDirectory: session.workingDirectory,
          workspaceId: session.planningWorkspaceId,
          workItemId: session.workItemId,
          workItemIdentifier: session.workItemIdentifier,
          linkedTask: session.linkedTask,
        }}
      />
    </main>
  );
}
