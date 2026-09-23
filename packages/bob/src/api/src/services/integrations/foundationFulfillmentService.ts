import { and, eq } from "@bob/db";
import type { Db } from "@bob/db/client";
import { taskRuns } from "@bob/db/schema";

export interface FoundationRunFact {
  taskRunId: string;
  sessionId: string;
  userId: string;
  workspaceId: string;
  planningItemId: string;
  completedAt: string;
}
export interface FoundationRunCompletion {
  recordCompletion(fact: FoundationRunFact): Promise<{ fulfillmentEndId: string; runLinkId: string }>;
}
/** Explicit, opt-in reconciliation. Authenticated user/workspace must be server-derived.
 * Only a persisted completed run is accepted. Retrying never repeats task execution.
 * No startedAt exists on taskRuns: the adapter must use a separately recorded real start.
 */
export async function reconcileRunFoundationCompletion(
  db: Db,
  authorized: { userId: string; workspaceId: string },
  taskRunId: string,
  foundation: FoundationRunCompletion,
) {
  const run = await db.query.taskRuns.findFirst({where: and(eq(taskRuns.id, taskRunId),
    eq(taskRuns.userId, authorized.userId), eq(taskRuns.planningWorkspaceId, authorized.workspaceId))});
  if (!run || run.id !== taskRunId || run.userId !== authorized.userId || run.planningWorkspaceId !== authorized.workspaceId) {
    throw new Error("Task run not found in authorized workspace");
  }
  if (run.status !== "completed" || !run.completedAt || !run.sessionId) {
    throw new Error("Foundation completion requires a persisted completed run with session and timestamp");
  }
  return foundation.recordCompletion({taskRunId:run.id,sessionId:run.sessionId,userId:run.userId,
    workspaceId:run.planningWorkspaceId,planningItemId:run.planningItemId,
    completedAt:new Date(run.completedAt).toISOString()});
}
