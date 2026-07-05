import { and, eq } from "@bob/db";
import { db } from "@bob/db/client";
import type {
  projects} from "@bob/db/schema";
import {
  dispatchBatches,
  dispatchItems,
  workItems,
  workspaceIntegrations,
  workspaceMembers,
} from "@bob/db/schema";

import {
  markDeliveryFailed,
  markDeliveryProcessed,
} from "./processWebhook";
import { ensureLinearProject } from "../linear/ensureLinearProject";
import { traceWebhook } from "@bob/telemetry";

const LINEAR_BOB_ACTOR = "bob-automation";

interface LinearIssuePayload {
  action: "create" | "update" | "remove";
  type: "Issue";
  createdAt: string;
  data: {
    id: string;
    identifier: string;
    title: string;
    description: string | null;
    priority: number;
    state: {
      id: string;
      name: string;
      type: string;
    };
    team: {
      id: string;
      key: string;
    };
    project?: {
      id: string;
      name: string;
    } | null;
    assignee?: {
      id: string;
      name: string;
      email: string;
    } | null;
    // Optional: this interface describes an unchecked cast of the raw
    // webhook JSON body (see `payload as unknown as LinearIssuePayload`
    // below), so fields Linear's docs mark as always-present can still be
    // missing on malformed/older deliveries — kept optional rather than
    // asserted, with real `?? []` fallbacks at each read site.
    labels?: { id: string; name: string }[];
    creatorId?: string;
  };
  url: string;
  updatedFrom?: {
    stateId?: string;
    assigneeId?: string;
    title?: string;
    description?: string;
    priority?: number;
  };
}

function isBobOriginated(payload: LinearIssuePayload): boolean {
  if (payload.data.creatorId === LINEAR_BOB_ACTOR) return true;
  const labels = payload.data.labels ?? [];
  return labels.some((l) => l.name === "bob-managed");
}

function mapLinearStatusToBob(stateType: string): string {
  switch (stateType) {
    case "backlog":
      return "backlog";
    case "unstarted":
      return "todo";
    case "started":
      return "in_progress";
    case "completed":
      return "done";
    case "cancelled":
      return "cancelled";
    default:
      return "draft";
  }
}

/**
 * Resolve the Bob project for a Linear issue, creating it if the Linear project
 * hasn't been onboarded yet. This means a new Linear project self-onboards the
 * first time one of its issues hits the webhook — no manual "connect project"
 * step. Issues with no Linear project land in a stable per-team project.
 *
 * Returns null only when no Linear integration exists for the issue's team.
 */
async function resolveOrCreateProjectForIssue(
  payload: LinearIssuePayload,
): Promise<{
  project: typeof projects.$inferSelect;
  integration: typeof workspaceIntegrations.$inferSelect;
} | null> {
  const teamId = payload.data.team.id;
  const integrations = await db
    .select()
    .from(workspaceIntegrations)
    .where(
      and(
        eq(workspaceIntegrations.provider, "linear"),
        eq(workspaceIntegrations.enabled, true),
        eq(workspaceIntegrations.linearTeamId, teamId),
      ),
    );

  const [integration] = integrations;
  if (!integration) return null;

  // Use the Linear project when present; otherwise a synthetic per-team id so
  // project-less issues land in one stable "team" project instead of scattering.
  const linearProjectId = payload.data.project?.id ?? `team:${teamId}`;
  const name =
    payload.data.project?.name ?? `${payload.data.team.key} (Linear)`;

  const { project } = await ensureLinearProject(db, {
    workspaceId: integration.workspaceId,
    linearProjectId,
    name,
    autoDispatch: false,
  });

  return { project, integration };
}

async function findOrCreateWorkItem(
  payload: LinearIssuePayload,
  projectId: string,
  workspaceId: string,
  ownerUserId: string,
): Promise<typeof workItems.$inferSelect> {
  const existing = await db.query.workItems.findFirst({
    where: and(
      eq(workItems.externalId, payload.data.id),
      eq(workItems.externalProvider, "linear"),
    ),
  });

  if (existing) return existing;

  const [created] = await db
    .insert(workItems)
    .values({
      ownerUserId,
      workspaceId,
      projectId,
      kind: "task",
      title: payload.data.title,
      description: payload.data.description,
      status: mapLinearStatusToBob(payload.data.state.type),
      externalId: payload.data.id,
      externalProvider: "linear",
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create work item for Linear issue");
  }

  return created;
}

async function handleIssueCreate(payload: LinearIssuePayload): Promise<void> {
  if (isBobOriginated(payload)) {
    console.log(
      `[linear-webhook] Skipping bob-originated issue ${payload.data.identifier}`,
    );
    return;
  }

  const match = await resolveOrCreateProjectForIssue(payload);

  if (!match) {
    console.log(
      `[linear-webhook] No Linear integration for team ${payload.data.team.key}, skipping`,
    );
    return;
  }

  const { project } = match;

  const owner = await db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.workspaceId, project.workspaceId),
    columns: { userId: true },
    orderBy: (m, { asc }) => [asc(m.joinedAt)],
  });

  if (!owner) {
    console.log(`[linear-webhook] No workspace member found, skipping`);
    return;
  }

  // Always track the issue as a work item so it shows on the Board — this is
  // decoupled from autoDispatch, which only controls whether we ALSO run an
  // agent. (Previously autoDispatch=off skipped creation entirely, so synced
  // projects looked empty.)
  const workItem = await findOrCreateWorkItem(
    payload,
    project.id,
    project.workspaceId,
    owner.userId,
  );

  if (!project.automationSettings.autoDispatch) {
    console.log(
      `[linear-webhook] ${payload.data.identifier} tracked for project ${project.key} (autoDispatch off — not dispatched)`,
    );
    return;
  }

  const [batch] = await db
    .insert(dispatchBatches)
    .values({
      userId: owner.userId,
      workspaceId: project.workspaceId,
      projectId: project.id,
      status: "dispatching",
      concurrency: 1,
      totalTasks: 1,
    })
    .returning();

  if (!batch) {
    throw new Error("Failed to create dispatch batch for Linear issue");
  }

  await db.insert(dispatchItems).values({
    batchId: batch.id,
    planningTaskId: workItem.id,
    planningTaskIdentifier: payload.data.identifier,
    title: payload.data.title,
    description: payload.data.description,
    agentType: "opencode",
    status: "queued",
    sortOrder: 0,
    planningProvider: "linear",
  });

  try {
    const { executeTask } = await import(
      "@bob/execution/runtime/taskExecutor"
    );

    const result = await executeTask(
      owner.userId,
      {
        id: workItem.id,
        identifier: payload.data.identifier,
        title: payload.data.title,
        description: payload.data.description,
        workspaceId: project.workspaceId,
        projectId: project.id,
        assigneeId: null,
        labels: (payload.data.labels ?? []).map((l) => l.name),
        priority: payload.data.priority,
      },
      { agentType: "opencode" },
    );

    await db
      .update(dispatchItems)
      .set({ status: "running", taskRunId: result.taskRunId })
      .where(eq(dispatchItems.batchId, batch.id));

    await db
      .update(dispatchBatches)
      .set({ status: "running" })
      .where(eq(dispatchBatches.id, batch.id));

    console.log(
      `[linear-webhook] Dispatched ${payload.data.identifier} → taskRun ${result.taskRunId}`,
    );
  } catch (err) {
    console.error(
      `[linear-webhook] Failed to dispatch ${payload.data.identifier}:`,
      err,
    );

    await db
      .update(dispatchItems)
      .set({ status: "failed" })
      .where(eq(dispatchItems.batchId, batch.id));

    await db
      .update(dispatchBatches)
      .set({ status: "failed", failedTasks: 1 })
      .where(eq(dispatchBatches.id, batch.id));
  }
}

async function handleIssueUpdate(payload: LinearIssuePayload): Promise<void> {
  const existing = await db.query.workItems.findFirst({
    where: and(
      eq(workItems.externalId, payload.data.id),
      eq(workItems.externalProvider, "linear"),
    ),
  });

  // Onboard issues that were updated before their project was synced: create
  // the project (if needed) and the work item so it appears on the Board.
  if (!existing) {
    if (isBobOriginated(payload)) return;
    const match = await resolveOrCreateProjectForIssue(payload);
    if (!match) return;
    const owner = await db.query.workspaceMembers.findFirst({
      where: eq(workspaceMembers.workspaceId, match.project.workspaceId),
      columns: { userId: true },
      orderBy: (m, { asc }) => [asc(m.joinedAt)],
    });
    if (!owner) return;
    await findOrCreateWorkItem(
      payload,
      match.project.id,
      match.project.workspaceId,
      owner.userId,
    );
    return;
  }

  const updates: Record<string, unknown> = {};

  if (payload.updatedFrom?.title !== undefined) {
    updates.title = payload.data.title;
  }
  if (payload.updatedFrom?.description !== undefined) {
    updates.description = payload.data.description;
  }
  if (payload.updatedFrom?.stateId !== undefined) {
    updates.status = mapLinearStatusToBob(payload.data.state.type);
  }

  if (Object.keys(updates).length > 0) {
    await db
      .update(workItems)
      .set(updates)
      .where(eq(workItems.id, existing.id));
  }
}

async function handleIssueRemove(payload: LinearIssuePayload): Promise<void> {
  const existing = await db.query.workItems.findFirst({
    where: and(
      eq(workItems.externalId, payload.data.id),
      eq(workItems.externalProvider, "linear"),
    ),
  });

  if (!existing) return;

  await db
    .update(workItems)
    .set({ status: "cancelled" })
    .where(eq(workItems.id, existing.id));
}

export async function processLinearWebhook(
  eventType: string,
  payload: Record<string, unknown>,
  deliveryId: string,
): Promise<void> {
  return traceWebhook("linear", eventType, async () => {
    try {
      // `payload` is genuinely untyped webhook JSON — check the discriminant
      // field as `unknown` before committing to the full LinearIssuePayload
      // shape, so this is a real runtime filter (non-Issue payloads exist,
      // e.g. Comment/Project webhooks) rather than a statically-impossible
      // comparison against a cast-in literal type.
      if ((payload as { type?: unknown }).type !== "Issue") {
        await markDeliveryProcessed(deliveryId);
        return;
      }

      const linearPayload = payload as unknown as LinearIssuePayload;

      switch (linearPayload.action) {
        case "create":
          await handleIssueCreate(linearPayload);
          break;
        case "update":
          await handleIssueUpdate(linearPayload);
          break;
        case "remove":
          await handleIssueRemove(linearPayload);
          break;
      }

      await markDeliveryProcessed(deliveryId);
    } catch (error) {
      await markDeliveryFailed(
        deliveryId,
        error instanceof Error ? error.message : "Unknown error",
      );
      throw error;
    }
  });
}
