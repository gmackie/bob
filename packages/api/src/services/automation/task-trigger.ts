import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { dispatchBatches, dispatchItems, projects } from "@bob/db/schema";
import { executeTask } from "@bob/execution/runtime/taskExecutor";

import { suggestAgent } from "../dispatch/agentHeuristics";
import { isAutomationEnabled } from "./settings";

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

  if (!isAutomationEnabled(project.automationSettings, "autoDispatch")) {
    return { dispatched: false };
  }

  // Create a dispatch batch with this single task
  const [batch] = await db
    .insert(dispatchBatches)
    .values({
      userId: params.userId,
      workspaceId: project.workspaceId,
      projectId: params.projectId,
      status: "running",
      totalTasks: 1,
      completedTasks: 0,
      failedTasks: 0,
    })
    .returning();

  if (!batch) return { dispatched: false };

  const agentType = suggestAgent({
    kind: "task",
    title: params.title ?? "",
    description: null,
  });

  const [item] = await db.insert(dispatchItems).values({
    batchId: batch.id,
    planningTaskId: params.taskId,
    planningTaskIdentifier: params.identifier ?? "UNKNOWN",
    title: params.title ?? "Auto-dispatched task",
    agentType,
    status: "queued",
    sortOrder: 0,
  }).returning();

  try {
    const result = await executeTask(
      params.userId,
      {
        id: params.taskId,
        identifier: params.identifier ?? "UNKNOWN",
        title: params.title ?? "Auto-dispatched task",
        description: null,
        workspaceId: project.workspaceId,
        projectId: params.projectId,
        assigneeId: null,
        labels: [],
        priority: 0,
      },
      { agentType },
    );

    if (item) {
      await db
        .update(dispatchItems)
        .set({
          status: result.status === "blocked" ? "failed" : "running",
          taskRunId: result.taskRunId,
        })
        .where(eq(dispatchItems.id, item.id));
    }

    if (result.status === "blocked") {
      await db
        .update(dispatchBatches)
        .set({ status: "failed", failedTasks: 1 })
        .where(eq(dispatchBatches.id, batch.id));
      return { dispatched: false, batchId: batch.id };
    }
  } catch (err) {
    console.error("[automation] auto-dispatch failed:", err);
    if (item) {
      await db
        .update(dispatchItems)
        .set({ status: "failed" })
        .where(eq(dispatchItems.id, item.id));
    }
    await db
      .update(dispatchBatches)
      .set({ status: "failed", failedTasks: 1 })
      .where(eq(dispatchBatches.id, batch.id));
    return { dispatched: false, batchId: batch.id };
  }

  return { dispatched: true, batchId: batch.id };
}
