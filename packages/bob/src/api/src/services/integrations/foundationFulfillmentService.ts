import type { Db } from "@bob/db/client";
import { and, eq } from "@bob/db";
import { taskRuns } from "@bob/db/schema";

export interface FoundationRunFact {
  taskRunId: string;
  sessionId: string;
  userId: string;
  workspaceId: string;
  planningItemId: string;
  completedAt: string;
}
/** The adapter must deduplicate by taskRunId within the authorized workspace. */
export interface FoundationRunCompletion {
  recordCompletion(
    fact: FoundationRunFact,
  ): Promise<{ fulfillmentEndId: string; runLinkId: string }>;
}
/** Explicit, opt-in reconciliation. Authenticated user/workspace must be server-derived.
 * Only a persisted completed run is accepted. Retrying never repeats task execution.
 * No startedAt exists on taskRuns: the adapter must use a separately recorded real start.
 */
export async function reconcileRunFoundationCompletion(
  db: Pick<Db, "query">,
  authorized: { userId: string; workspaceId: string },
  taskRunId: string,
  foundation: FoundationRunCompletion,
) {
  const run = await db.query.taskRuns.findFirst({
    where: and(
      eq(taskRuns.id, taskRunId),
      eq(taskRuns.userId, authorized.userId),
      eq(taskRuns.planningWorkspaceId, authorized.workspaceId),
    ),
  });
  if (
    run?.id !== taskRunId ||
    run.userId !== authorized.userId ||
    run.planningWorkspaceId !== authorized.workspaceId
  ) {
    throw new Error("Task run not found in authorized workspace");
  }
  if (
    run.status !== "completed" ||
    !run.completedAt ||
    !run.sessionId ||
    !run.planningItemId
  ) {
    throw new Error(
      "Foundation completion requires a persisted completed run with planning item, session and timestamp",
    );
  }
  const completedAt = new Date(run.completedAt);
  if (!Number.isFinite(completedAt.getTime())) {
    throw new Error(
      "Foundation completion requires a valid completion timestamp",
    );
  }
  return foundation.recordCompletion({
    taskRunId: run.id,
    sessionId: run.sessionId,
    userId: run.userId,
    workspaceId: run.planningWorkspaceId,
    planningItemId: run.planningItemId,
    completedAt: completedAt.toISOString(),
  });
}
