import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { dispatchBatches, dispatchItems, projects } from "@bob/db/schema";

/**
 * Called when a task's status changes. Checks project automation settings
 * and dispatches an agent if conditions are met.
 *
 * This is invoked fire-and-forget from the planning router's updateTask
 * mutation, so failures here never block the API response.
 */
export async function onTaskStatusChange(params: {
  taskId: string;
  projectId: string | null;
  oldStatus: string | undefined;
  newStatus: string;
  userId: string;
  /** Planning-side identifier like "BOB-42" */
  identifier?: string;
  title?: string;
}): Promise<{ dispatched: boolean; batchId?: string }> {
  // Only trigger on transition TO in_progress
  if (params.newStatus !== "in_progress") {
    return { dispatched: false };
  }

  // If old status was already in_progress, nothing to do
  if (params.oldStatus === "in_progress") {
    return { dispatched: false };
  }

  // Must have a project to look up automation settings
  if (!params.projectId) return { dispatched: false };

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, params.projectId));

  if (!project) return { dispatched: false };

  // Future: check project-level automationSettings (Task 13.5).
  // For now auto-dispatch is disabled by default so this service
  // only fires when explicitly opted-in via an upstream caller.
  // We leave the wiring in place so Task 13.5 can flip the switch.

  // Create a dispatch batch with this single task
  const [batch] = await db
    .insert(dispatchBatches)
    .values({
      userId: params.userId,
      workspaceId: project.workspaceId,
      projectId: params.projectId,
      status: "dispatching",
      totalTasks: 1,
      completedTasks: 0,
      failedTasks: 0,
    })
    .returning();

  if (!batch) return { dispatched: false };

  await db.insert(dispatchItems).values({
    batchId: batch.id,
    planningTaskId: params.taskId,
    planningTaskIdentifier: params.identifier ?? "UNKNOWN",
    title: params.title ?? "Auto-dispatched task",
    status: "queued",
    sortOrder: 0,
  });

  return { dispatched: true, batchId: batch.id };
}
