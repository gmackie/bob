import { and, eq, inArray } from "@bob/db";
import type { Db } from "@bob/db/client";
import {
  dispatchBatches,
  dispatchItems,
  projects,
  workItems,
} from "@bob/db/schema";

import { suggestAgent } from "../services/dispatch/agentHeuristics";

function formatWorkItemIdentifier(input: {
  projectKey: string | null;
  sequenceNumber: number | null | undefined;
  id: string;
}): string {
  if (input.projectKey && input.sequenceNumber && input.sequenceNumber > 0) {
    return `${input.projectKey}-${input.sequenceNumber}`;
  }

  const suffix = input.id.slice(0, 8).toUpperCase();
  return input.projectKey ? `${input.projectKey}-${suffix}` : `TASK-${suffix}`;
}

export async function tryAutoDispatch(
  db: Db,
  opts: { workItemId: string },
): Promise<{ dispatched: boolean; batchId?: string; reason?: string }> {
  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, opts.workItemId),
  });

  if (!workItem) return { dispatched: false, reason: "work_item_not_found" };
  if (!workItem.projectId) return { dispatched: false, reason: "no_project" };
  if (!workItem.workspaceId) return { dispatched: false, reason: "no_workspace" };
  if (!["ready", "in_progress"].includes(workItem.status)) {
    return { dispatched: false, reason: "status_not_dispatchable" };
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, workItem.projectId),
  });

  if (!project) return { dispatched: false, reason: "project_not_found" };
  if (project.automationSettings?.autoDispatch !== true) {
    return { dispatched: false, reason: "auto_dispatch_disabled" };
  }

  const activeItem = await db.query.dispatchItems.findFirst({
    where: and(
      eq(dispatchItems.planningTaskId, workItem.id),
      inArray(dispatchItems.status, ["queued", "blocked", "running"]),
    ),
  });

  if (activeItem) {
    return { dispatched: false, reason: "already_active" };
  }

  const identifier = formatWorkItemIdentifier({
    projectKey: project.key,
    sequenceNumber: workItem.sequenceNumber,
    id: workItem.id,
  });

  const [batch] = await db
    .insert(dispatchBatches)
    .values({
      userId: workItem.ownerUserId,
      workspaceId: workItem.workspaceId,
      projectId: workItem.projectId,
      status: "dispatching",
      concurrency: 1,
      totalTasks: 1,
    })
    .returning();

  if (!batch) return { dispatched: false, reason: "batch_not_created" };

  const [item] = await db
    .insert(dispatchItems)
    .values({
      batchId: batch.id,
      planningTaskId: workItem.id,
      planningTaskIdentifier: identifier,
      title: workItem.title,
      description: workItem.description ?? null,
      agentType: suggestAgent({
        kind: workItem.kind,
        title: workItem.title,
        description: workItem.description ?? null,
      }),
      status: "queued",
      sortOrder: 0,
    })
    .returning();

  if (!item) return { dispatched: false, reason: "item_not_created" };

  try {
    const { executeTask } = await import("@bob/execution/runtime/taskExecutor");
    const result = await executeTask(
      workItem.ownerUserId,
      {
        id: workItem.id,
        identifier,
        title: workItem.title,
        description: workItem.description,
        workspaceId: workItem.workspaceId,
        projectId: workItem.projectId,
        assigneeId: null,
        labels: [],
        priority: 0,
      },
      { agentType: item.agentType },
    );

    await db
      .update(dispatchItems)
      .set({ status: "running", taskRunId: result.taskRunId })
      .where(eq(dispatchItems.id, item.id));

    await db
      .update(dispatchBatches)
      .set({ status: "running" })
      .where(eq(dispatchBatches.id, batch.id));

    return { dispatched: true, batchId: batch.id };
  } catch (err) {
    console.error("[auto-dispatch] Failed to start dispatch item:", err);
    await db
      .update(dispatchItems)
      .set({ status: "failed" })
      .where(eq(dispatchItems.id, item.id));
    await db
      .update(dispatchBatches)
      .set({ status: "failed", failedTasks: 1 })
      .where(eq(dispatchBatches.id, batch.id));

    return { dispatched: false, batchId: batch.id, reason: "execute_failed" };
  }
}
