import { notFound } from "next/navigation";

import { ExecutionSessionWorkspace } from "~/components/sessions/execution-session-workspace";
import { createPlanningCaller } from "~/lib/planning/server";

interface ExecutionSessionRouteProps {
  params: Promise<{ sessionId: string }>;
}

export const dynamic = "force-dynamic";

export default async function ExecutionSessionRoute({
  params,
}: ExecutionSessionRouteProps) {
  const { sessionId } = await params;
  const caller = (await createPlanningCaller()) as any;
  const session = await caller.session.get({ id: sessionId }).catch(() => null);

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
          workspaceId: session.workspaceId,
          workItemId: session.workItemId,
          workItemIdentifier: session.workItemIdentifier,
          linkedTask: session.linkedTask,
        }}
      />
    </main>
  );
}
