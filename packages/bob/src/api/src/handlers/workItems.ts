/**
 * Work-item handler functions — pure business logic extracted from the tRPC
 * workItems router.
 *
 * Phase 7B-4D-beta Task 9.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, or, sql } from "@bob/db";
import { inArray } from "@bob/db";
import type { Db } from "@bob/db/client";
import {
  activities,
  agentRuns,
  chatConversations,
  comments,
  notifications,
  projects,
  repositories,
  runLifecycleEvents,
  taskRuns,
  workItemDependencies,
  workItemArtifacts,
  workItems,
  workspaceMembers,
  workspaces,
} from "@bob/db/schema";
import { resolveAgentType } from "@bob/work-items";
import type {
  WorkItemKind,
  WorkItemArtifactType,
  WorkItemArtifactProducerType as WorkItemArtifactProducerTypeDb,
  WorkItemNotificationType,
} from "@bob/work-items/schema";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ACTIVE_LINKED_SESSION_STATUSES = [
  "queued",
  "running",
  "starting",
  "provisioning",
  "pending",
  "awaiting-input",
  "awaiting_input",
  // Paused awaiting a human decision — still active (the "needs you" state).
  "blocked",
  // Lease expired: contact lost, process fate unknown — still active.
  "host_unknown",
];

/**
 * Reads an optional string-typed field off a value whose shape isn't
 * statically guaranteed to include it (e.g. a `workItems` row that some
 * caller enriched with an extra ad hoc field not backed by a real column).
 * Returns `null` unless the field is genuinely present and a string.
 */
function readOptionalStringField(value: unknown, field: string): string | null {
  if (typeof value !== "object" || value === null || !(field in value)) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[field];
  return typeof raw === "string" ? raw : null;
}

async function assertWorkspaceAccess(db: Db, userId: string, workspaceId: string) {
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

async function notifyWorkspaceEvent(input: {
  type: string;
  workspaceId: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}) {
  const gatewayUrl = process.env.GATEWAY_URL;
  const nudgeSecret = process.env.NUDGE_SHARED_SECRET;
  if (!gatewayUrl || !nudgeSecret) return;

  try {
    await fetch(`${gatewayUrl}/internal/workspace-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${nudgeSecret}`,
      },
      body: JSON.stringify(input),
    });
  } catch (err) {
    console.warn("[workItems] workspace event notification failed:", err);
  }
}

async function assertWorkItemAccess(db: Db, userId: string, workItem: { workspaceId: string | null | undefined }) {
  if (!workItem.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await assertWorkspaceAccess(db, userId, workItem.workspaceId);
}

async function loadAccessibleWorkItem(db: Db, userId: string, workItemId: string) {
  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
  });

  if (!workItem) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await assertWorkItemAccess(db, userId, workItem);
  return workItem;
}

/** Parse a short identifier like "BOB-27" into { projectKey, sequenceNumber }. */
function parseIdentifier(id: string): { projectKey: string; sequenceNumber: number } | null {
  const match = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(id);
  const projectKey = match?.[1];
  const sequencePart = match?.[2];
  if (!projectKey || !sequencePart) return null;
  return { projectKey: projectKey.toUpperCase(), sequenceNumber: parseInt(sequencePart, 10) };
}

export function formatWorkItemIdentifier(input: {
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

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function workItemsList(
  ctx: HandlerContext,
  input: {
    workspaceId: string;
    projectId?: string;
    parentId?: string | null;
    kind?: WorkItemKind;
    status?: string;
    statuses?: string[];
    limit?: number;
  },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  const items = await ctx.db.query.workItems.findMany({
    where: and(
      eq(workItems.workspaceId, input.workspaceId),
      input.projectId ? eq(workItems.projectId, input.projectId) : undefined,
      input.parentId === null
        ? isNull(workItems.parentId)
        : input.parentId
          ? eq(workItems.parentId, input.parentId)
          : undefined,
      input.kind ? eq(workItems.kind, input.kind) : undefined,
      // `statuses` (multi) takes precedence over the single `status`. A
      // status-scoped fetch is what keeps the backlog visible in a workspace
      // dominated by terminal/in_review items — see the schema comment.
      input.statuses && input.statuses.length > 0
        ? inArray(workItems.status, input.statuses)
        : input.status
          ? eq(workItems.status, input.status)
          : undefined,
    ),
    orderBy: [workItems.queueSortOrder, desc(workItems.updatedAt)],
    limit: input.limit,
  });

  const projectIds = Array.from(
    new Set(
      items
        .map((item) => item.projectId)
        .filter((projectId): projectId is string => Boolean(projectId)),
    ),
  );
  const projectRows =
    projectIds.length > 0
      ? await ctx.db.query.projects.findMany({
          where: eq(projects.workspaceId, input.workspaceId),
        })
      : [];

  const projectById = new Map(projectRows.map((project) => [project.id, project]));

  const itemIds = items.map((i) => i.id);
  const activeSessions =
    itemIds.length > 0
      ? await ctx.db.query.chatConversations.findMany({
          where: and(
            inArray(chatConversations.workItemId, itemIds),
            inArray(chatConversations.status, ACTIVE_LINKED_SESSION_STATUSES),
          ),
          columns: { id: true, workItemId: true, status: true, agentType: true },
        })
      : [];
  const sessionByWorkItem = new Map(
    activeSessions
      .filter((s): s is typeof s & { workItemId: string } => s.workItemId !== null)
      .map((s) => [s.workItemId, s]),
  );

  return items.map((item) => {
    const project = item.projectId ? (projectById.get(item.projectId) ?? null) : null;
    const activeSession = sessionByWorkItem.get(item.id);

    return {
      ...item,
      identifier:
        item.externalId ??
        formatWorkItemIdentifier({
          projectKey: project?.key ?? null,
          sequenceNumber: item.sequenceNumber,
          id: item.id,
        }),
      project,
      agentStatus: activeSession
        ? { sessionId: activeSession.id, status: activeSession.status, agentType: activeSession.agentType }
        : null,
    };
  });
}

/**
 * Per-status work-item counts for a workspace. A cheap GROUP BY that returns
 * the FULL totals (e.g. { in_review: 329, backlog: 25, in_progress: 8, ... })
 * regardless of the list cap, so lane cards and sidebar badges can display
 * accurate numbers instead of counting a recency-truncated page of rows.
 */
export async function workItemStatusCounts(
  ctx: HandlerContext,
  input: { workspaceId: string; kind?: WorkItemKind },
): Promise<Record<string, number>> {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  const rows = await ctx.db
    .select({ status: workItems.status, count: sql<number>`count(*)::int` })
    .from(workItems)
    .where(
      and(
        eq(workItems.workspaceId, input.workspaceId),
        input.kind ? eq(workItems.kind, input.kind) : undefined,
      ),
    )
    .groupBy(workItems.status);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.status) counts[row.status] = Number(row.count);
  }
  return counts;
}

export async function workItemsGet(
  ctx: HandlerContext,
  input: { id: string },
) {
  // Try UUID lookup first
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id);

  let workItem;
  if (isUuid) {
    workItem = await ctx.db.query.workItems.findFirst({
      where: eq(workItems.id, input.id),
    });
  } else {
    // Try short identifier lookup (e.g. "BOB-27")
    const parsed = parseIdentifier(input.id);
    if (parsed) {
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.key, parsed.projectKey),
      });
      if (project) {
        workItem = await ctx.db.query.workItems.findFirst({
          where: and(
            eq(workItems.projectId, project.id),
            eq(workItems.sequenceNumber, parsed.sequenceNumber),
          ),
        });
      }
    }
  }

  if (!workItem) {
    return null;
  }

  await assertWorkItemAccess(ctx.db, ctx.userId, workItem);

  const dependencyQueries = ctx.db.query.workItemDependencies;
  const [project, currentArtifacts, children, activeSession, dependencies, dependents] = await Promise.all([
    workItem.projectId
      ? ctx.db.query.projects.findFirst({
          where: eq(projects.id, workItem.projectId),
        })
      : Promise.resolve(null),
    ctx.db.query.workItemArtifacts.findMany({
      where: and(
        eq(workItemArtifacts.workItemId, workItem.id),
        eq(workItemArtifacts.isCurrent, true),
      ),
      orderBy: desc(workItemArtifacts.createdAt),
    }),
    ctx.db.query.workItems.findMany({
      where: eq(workItems.parentId, workItem.id),
    }),
    ctx.db.query.chatConversations.findFirst({
      where: and(
        eq(chatConversations.workItemId, workItem.id),
        inArray(chatConversations.status, ACTIVE_LINKED_SESSION_STATUSES),
      ),
      columns: { id: true, workItemId: true, status: true, agentType: true },
    }),
    dependencyQueries.findMany({
      where: eq(workItemDependencies.workItemId, workItem.id),
      with: {
        dependsOn: {
          columns: {
            id: true,
            externalId: true,
            sequenceNumber: true,
            projectId: true,
            title: true,
            status: true,
          },
        },
      },
    }),
    dependencyQueries.findMany({
      where: eq(workItemDependencies.dependsOnWorkItemId, workItem.id),
      with: {
        workItem: {
          columns: {
            id: true,
            externalId: true,
            sequenceNumber: true,
            projectId: true,
            title: true,
            status: true,
          },
        },
      },
    }),
  ]);

  return {
    workItem: {
      ...workItem,
      identifier: formatWorkItemIdentifier({
        projectKey: project?.key ?? null,
        sequenceNumber: workItem.sequenceNumber,
        id: workItem.id,
      }),
      project,
      agentStatus: activeSession
        ? {
            sessionId: activeSession.id,
            status: activeSession.status,
            agentType: activeSession.agentType,
          }
        : null,
      dependencies: dependencies
        .map((row) => row.dependsOn)
        .map((item) => formatRelatedWorkItem(item, project ?? null)),
      dependents: dependents
        .map((row) => row.workItem)
        .map((item) => formatRelatedWorkItem(item, project ?? null)),
    },
    currentArtifacts,
    childCount: children.length,
  };
}

function formatRelatedWorkItem(
  item: {
    id: string;
    externalId?: string | null;
    sequenceNumber?: number | null;
    projectId?: string | null;
    title: string;
    status: string;
  },
  currentProject: { id: string; key: string } | null,
) {
  const projectKey =
    currentProject && item.projectId === currentProject.id ? currentProject.key : null;

  return {
    id: item.id,
    identifier:
      item.externalId ??
      formatWorkItemIdentifier({
        projectKey,
        sequenceNumber: item.sequenceNumber,
        id: item.id,
      }),
    title: item.title,
    status: item.status,
  };
}

export async function workItemsUpdate(
  ctx: HandlerContext,
  input: {
    id: string;
    title?: string;
    description?: string | null;
    status?: string;
    // NOTE: `priority` has no backing column on `workItems` (it only exists
    // on `planDrafts`/`planTaskItems`, an earlier pipeline stage) — see
    // no-op discussion below. Accepted here for API-input-shape compat but
    // deliberately excluded from the `.update(workItems)` payload.
    priority?: string;
    agentTypeOverride?: string | null;
  },
) {
  const existing = await loadAccessibleWorkItem(
    ctx.db,
    ctx.userId,
    input.id,
  );

  // `priority` is intentionally omitted: `workItems` has no `priority`
  // column, so persisting it here would either throw (strict driver) or be
  // silently ignored (this was previously masked by `db: any`). Preserved
  // as a no-op for API-shape compatibility until/unless a real column is
  // added — flagged rather than fixed as part of lint cleanup since it's a
  // product/schema decision out of scope for type-safety-only changes.
  const updates: Partial<typeof workItems.$inferInsert> = Object.fromEntries(
    Object.entries({
      title: input.title,
      description: input.description,
      status: input.status,
      agentTypeOverride: input.agentTypeOverride,
    }).filter(([, value]) => value !== undefined),
  );

  // `priority` has no backing column (see note above) but must still count
  // as "something to update" so its change-notification fires below, even
  // when it's the only field the caller passed.
  if (Object.keys(updates).length === 0 && input.priority === undefined) {
    return existing;
  }

  const workItem =
    Object.keys(updates).length > 0
      ? (
          await ctx.db
            .update(workItems)
            .set(updates)
            .where(eq(workItems.id, input.id))
            .returning()
        )[0]
      : undefined;

  const nextWorkItem = workItem ?? existing;

  const changedFields = ([
    {
      field: "title" as const,
      previousValue: existing.title,
      nextValue: input.title ?? null,
    },
    {
      field: "description" as const,
      previousValue: existing.description ?? null,
      nextValue: input.description ?? null,
    },
    {
      field: "status" as const,
      previousValue: existing.status,
      nextValue: input.status ?? null,
    },
    {
      // `workItems` has no `priority` column (see note above), so a real DB
      // row never carries this field — but some callers/tests attach one
      // ad hoc, and prior (masked-by-`any`) behavior read it back when
      // present. `existing`'s shape is genuinely not staticaly knowable
      // here (it may be enriched beyond the `workItems` row), so narrow via
      // `unknown` rather than widening the whole function back to `any`.
      field: "priority" as const,
      previousValue: readOptionalStringField(existing, "priority"),
      nextValue: input.priority ?? null,
    },
  ] satisfies {
    field: "title" | "description" | "status" | "priority";
    previousValue: string | null;
    nextValue: string | null;
  }[]).filter(
    (change) =>
      change.nextValue !== null && change.previousValue !== change.nextValue,
  );

  if (changedFields.length > 0) {
    await ctx.db.insert(activities).values(
      changedFields.map((change) => ({
        workItemId: input.id,
        userId: ctx.userId,
        type: "status_changed" as const,
        fromValue: change.previousValue,
        toValue: change.nextValue,
        metadata: { field: change.field },
      })),
    );
  }

  const statusChange = changedFields.find((change) => change.field === "status");
  if (statusChange && existing.workspaceId) {
    await notifyWorkspaceEvent({
      type: "task_status_changed",
      workspaceId: existing.workspaceId,
      entityId: input.id,
      payload: {
        previousStatus: statusChange.previousValue,
        status: statusChange.nextValue,
      },
    });
  }

  const priorityChange = changedFields.find((change) => change.field === "priority");
  if (priorityChange && existing.workspaceId) {
    await notifyWorkspaceEvent({
      type: "task_priority_changed",
      workspaceId: existing.workspaceId,
      entityId: input.id,
      payload: {
        previousPriority: priorityChange.previousValue,
        priority: priorityChange.nextValue,
      },
    });
  }

  return nextWorkItem;
}

export async function workItemsReorderQueue(
  ctx: HandlerContext,
  input: {
    workspaceId: string;
    workItemIds: string[];
  },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  for (const [index, workItemId] of input.workItemIds.entries()) {
    await ctx.db
      .update(workItems)
      .set({ queueSortOrder: index })
      .where(
        and(
          eq(workItems.id, workItemId),
          eq(workItems.workspaceId, input.workspaceId),
        ),
      );
  }

  await notifyWorkspaceEvent({
    type: "queue_order_changed",
    workspaceId: input.workspaceId,
    entityId: input.workItemIds[0],
    payload: { workItemIds: input.workItemIds },
  });

  return { success: true };
}

export async function workItemsPromoteToTask(
  ctx: HandlerContext,
  input: { id: string },
) {
  const existing = await loadAccessibleWorkItem(
    ctx.db,
    ctx.userId,
    input.id,
  );

  if (existing.kind === "task") {
    return existing;
  }

  // Update local DB
  const [workItem] = await ctx.db
    .update(workItems)
    .set({
      kind: "task",
    })
    .where(eq(workItems.id, input.id))
    .returning();

  await ctx.db
    .insert(activities)
    .values({
      workItemId: input.id,
      userId: ctx.userId,
      type: "status_changed",
      fromValue: existing.kind,
      toValue: "task",
      metadata: {
        field: "kind",
      },
    })
    .returning();

  return workItem ?? existing;
}

export async function workItemsListComments(
  ctx: HandlerContext,
  input: { workItemId: string },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  return ctx.db.query.comments.findMany({
    where: eq(comments.workItemId, input.workItemId),
    orderBy: desc(comments.createdAt),
  });
}

export async function workItemsCreateComment(
  ctx: HandlerContext,
  input: {
    workItemId: string;
    parentId?: string | null;
    body: string;
    bodyHtml?: string | null;
  },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  const [comment] = await ctx.db
    .insert(comments)
    .values({
      workItemId: input.workItemId,
      userId: ctx.userId,
      parentId: input.parentId ?? null,
      body: input.body,
      bodyHtml: input.bodyHtml ?? null,
    })
    .returning();

  await ctx.db
    .insert(activities)
    .values({
      workItemId: input.workItemId,
      userId: ctx.userId,
      type: "comment_added",
      metadata: { commentId: comment?.id ?? null },
    })
    .returning();

  return comment;
}

export async function workItemsCreateArtifact(
  ctx: HandlerContext,
  input: {
    workItemId: string;
    taskRunId?: string | null;
    sessionId?: string | null;
    producerType: string;
    producerId?: string | null;
    artifactType: WorkItemArtifactType;
    artifactRole: string;
    url?: string | null;
    title?: string | null;
    summary?: string | null;
    content?: string | null;
    metadata?: unknown;
  },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  const existingArtifacts = await ctx.db.query.workItemArtifacts.findMany({
    where: eq(workItemArtifacts.workItemId, input.workItemId),
  });

  const duplicateArtifact =
    input.producerId == null
      ? null
      : existingArtifacts.find(
          (artifact) =>
            artifact.producerType === input.producerType &&
            artifact.producerId === input.producerId,
        );

  if (duplicateArtifact) {
    return duplicateArtifact;
  }

  const currentArtifactsForRole = existingArtifacts.filter(
    (artifact) =>
      artifact.artifactRole === input.artifactRole && artifact.isCurrent,
  );

  if (currentArtifactsForRole.length > 0) {
    await ctx.db
      .update(workItemArtifacts)
      .set({ isCurrent: false })
      .where(
        and(
          eq(workItemArtifacts.workItemId, input.workItemId),
          eq(workItemArtifacts.artifactRole, input.artifactRole),
          eq(workItemArtifacts.isCurrent, true),
        ),
      )
      .returning();
  }

  // The zod schema in @bob/work-items and the DB enum in @bob/db diverge on
  // producerType values ("session"/"task_run"/"integration"/"manual" vs
  // "bob"/"forgegraph"/"human"/"system"). That mismatch predates this change;
  // cast through `any` to preserve the previous runtime behavior until the
  // schemas are reconciled.
  const [artifact] = await ctx.db
    .insert(workItemArtifacts)
    .values({
      workItemId: input.workItemId,
      taskRunId: input.taskRunId ?? null,
      sessionId: input.sessionId ?? null,
      producerType: input.producerType as unknown as WorkItemArtifactProducerTypeDb,
      producerId: input.producerId ?? null,
      artifactType: input.artifactType,
      artifactRole: input.artifactRole,
      url: input.url ?? null,
      title: input.title ?? null,
      summary: input.summary ?? null,
      content: input.content ?? null,
      metadata:
        (input.metadata as Record<string, unknown> | null | undefined) ?? null,
      isCurrent: true,
    })
    .returning();

  return artifact;
}

export async function workItemsListActivities(
  ctx: HandlerContext,
  input: { workItemId: string; limit?: number },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  return ctx.db.query.activities.findMany({
    where: eq(activities.workItemId, input.workItemId),
    orderBy: desc(activities.createdAt),
    limit: input.limit,
  });
}

export async function workItemsListCurrentArtifacts(
  ctx: HandlerContext,
  input: { workItemId: string },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  return ctx.db.query.workItemArtifacts.findMany({
    where: and(
      eq(workItemArtifacts.workItemId, input.workItemId),
      eq(workItemArtifacts.isCurrent, true),
    ),
    orderBy: desc(workItemArtifacts.createdAt),
  });
}

export async function workItemsListChildArtifactGroups(
  ctx: HandlerContext,
  input: { parentWorkItemId: string },
) {
  await loadAccessibleWorkItem(
    ctx.db,
    ctx.userId,
    input.parentWorkItemId,
  );

  const children = await ctx.db.query.workItems.findMany({
    where: eq(workItems.parentId, input.parentWorkItemId),
    orderBy: desc(workItems.updatedAt),
  });

  const groups = await Promise.all(
    children.map(async (child) => {
      const artifacts = await ctx.db.query.workItemArtifacts.findMany({
        where: and(
          eq(workItemArtifacts.workItemId, child.id),
          eq(workItemArtifacts.isCurrent, true),
        ),
        orderBy: desc(workItemArtifacts.createdAt),
      });

      return {
        workItem: child,
        artifacts,
      };
    }),
  );

  return groups.filter((group) => group.artifacts.length > 0);
}

export async function workItemsListNotifications(
  ctx: HandlerContext,
  input: { unreadOnly?: boolean; limit?: number },
) {
  const filters = [
    eq(notifications.userId, ctx.userId),
    isNull(notifications.archivedAt),
  ];

  if (input.unreadOnly) {
    filters.push(eq(notifications.read, false));
  }

  const items = await ctx.db.query.notifications.findMany({
    where: and(...filters),
    orderBy: desc(notifications.createdAt),
    limit: input.limit,
  });

  return { items };
}

export async function workItemsCreateNotification(
  ctx: HandlerContext,
  input: {
    userId: string;
    workItemId?: string | null;
    actorId?: string | null;
    type: WorkItemNotificationType;
    title: string;
    body?: string | null;
    url?: string | null;
  },
) {
  const [notification] = await ctx.db
    .insert(notifications)
    .values({
      userId: input.userId,
      workItemId: input.workItemId ?? null,
      actorId: input.actorId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      url: input.url ?? null,
    })
    .returning();

  return notification;
}

export async function workItemsMarkNotificationAsRead(
  ctx: HandlerContext,
  input: { id: string },
) {
  const [notification] = await ctx.db
    .update(notifications)
    .set({
      read: true,
      readAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(notifications.id, input.id),
        eq(notifications.userId, ctx.userId),
      ),
    )
    .returning();

  return notification;
}

export async function workItemsRegisterPushToken(
  ctx: HandlerContext,
  input: {
    token: string;
    platform: "ios" | "android" | "web";
    deviceName?: string;
  },
) {
  const { registerPushToken } = await import(
    "../services/push/pushService"
  );
  return registerPushToken({
    userId: ctx.userId,
    expoPushToken: input.token,
    deviceType: input.platform,
    deviceName: input.deviceName,
  });
}

export async function workItemsTaskRunListByWorkItem(
  ctx: HandlerContext,
  input: { workItemId: string },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  const runs = await ctx.db.query.taskRuns.findMany({
    where: and(
      eq(taskRuns.userId, ctx.userId),
      or(
        eq(taskRuns.workItemId, input.workItemId),
        eq(taskRuns.planningItemId, input.workItemId),
      ),
    ),
    orderBy: desc(taskRuns.createdAt),
  });

  return runs.map((run) => ({
    ...run,
    workItemId: run.workItemId ?? run.planningItemId,
    workItemIdentifier:
      run.workItemIdentifierSnapshot ?? run.planningItemIdentifier,
  }));
}

export async function workItemsTaskRunExecute(
  ctx: HandlerContext,
  input: { workItemId: string; agentType?: string },
) {
  const workItem = await loadAccessibleWorkItem(
    ctx.db,
    ctx.userId,
    input.workItemId,
  );

  const project = workItem.projectId
    ? await ctx.db.query.projects.findFirst({
        where: eq(projects.id, workItem.projectId),
      })
    : null;

  const identifier = formatWorkItemIdentifier({
    projectKey: project?.key ?? null,
    sequenceNumber: workItem.sequenceNumber,
    id: workItem.id,
  });

  const { executeTask } = await import(
    "@bob/execution/runtime/taskExecutor"
  );

  const result = await executeTask(
    ctx.userId,
    {
      id: workItem.id,
      identifier,
      title: workItem.title,
      description: workItem.description,
      workspaceId: workItem.workspaceId ?? "",
      projectId: workItem.projectId ?? "",
      assigneeId: null,
      labels: [],
      priority: 0,
    },
    {
      agentType: input.agentType ?? "claude",
    },
  );

  return result;
}

export async function workItemsDispatch(
  ctx: HandlerContext,
  input: { workItemId: string; agentType?: string },
) {
  const workItem = await loadAccessibleWorkItem(
    ctx.db,
    ctx.userId,
    input.workItemId,
  );

  const project = workItem.projectId
    ? await ctx.db.query.projects.findFirst({
        where: eq(projects.id, workItem.projectId),
      })
    : null;

  const identifier =
    workItem.externalId ??
    formatWorkItemIdentifier({
      projectKey: project?.key ?? null,
      sequenceNumber: workItem.sequenceNumber,
      id: workItem.id,
    });

  // An explicit agentType pins the choice; otherwise resolve the hierarchy:
  // work-item override -> project default -> workspace default -> "claude".
  // This session flows through the gateway to the runner, so the workspace
  // default also covers OODA-bound execution for this workspace.
  const workspace = workItem.workspaceId
    ? await ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, workItem.workspaceId),
        columns: { defaultAgentType: true },
      })
    : null;
  const agentType =
    input.agentType ??
    resolveAgentType({
      workItemOverride: workItem.agentTypeOverride,
      projectDefault: project?.defaultAgentType ?? null,
      workspaceDefault: workspace?.defaultAgentType ?? null,
    });

  // Resolve the project's mapped repository so the agent runs in an isolated
  // worktree off that repo (not the runner's own checkout) and can open a PR.
  // Falls back to the legacy hardcoded dir when no repo is mapped.
  const FALLBACK_DIR = "/home/bob/dev/gmacko-bob";
  const repository = project?.id
    ? await ctx.db.query.repositories.findFirst({
        where: eq(repositories.planningProjectId, project.id),
      })
    : null;
  const repoPath = repository?.path ?? FALLBACK_DIR;
  // Stable, filesystem-safe feature branch per work item.
  const branch = `bob/${identifier.toLowerCase().replace(/[^a-z0-9._/-]+/g, "-")}`;

  const [session] = await ctx.db
    .insert(chatConversations)
    .values({
      userId: ctx.userId,
      repositoryId: repository?.id ?? null,
      workingDirectory: repoPath,
      gitBranch: branch,
      agentType,
      sessionType: "execution",
      status: "pending",
      title: `${identifier}: ${workItem.title}`,
      workItemId: workItem.id,
      workItemIdentifierSnapshot: identifier,
    })
    .returning();

  if (!session) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create execution session",
    });
  }

  const gatewayUrl = process.env.GATEWAY_URL;
  const nudgeSecret = process.env.NUDGE_SHARED_SECRET;
  if (gatewayUrl && nudgeSecret) {
    try {
      await fetch(`${gatewayUrl}/internal/nudge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${nudgeSecret}`,
        },
        body: JSON.stringify({
          sessionId: session.id,
          workspaceId: workItem.workspaceId,
          workingDirectory: repoPath,
          agentType,
          title: session.title,
          sessionType: "execution",
          description: workItem.description ?? undefined,
          identifier,
          // The runner makes a worktree when `branch` is set (only when a repo
          // is mapped). workingDirectory carries the repo path; baseBranch is
          // detected on the runner. Both fields are forwarded by the gateway.
          branch: repository ? branch : undefined,
        }),
      });
    } catch (err) {
      console.warn("[workItems.dispatch] nudge failed:", err);
    }
  }

  return {
    sessionId: session.id,
    identifier,
    status: "pending",
  };
}

export async function workItemsTaskRunListLifecycleEvents(
  ctx: HandlerContext,
  input: { workItemId: string; limit?: number },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  const events = await ctx.db
    .select({
      id: runLifecycleEvents.id,
      taskRunId: runLifecycleEvents.taskRunId,
      eventType: runLifecycleEvents.eventType,
      phase: runLifecycleEvents.phase,
      metadata: runLifecycleEvents.metadata,
      createdAt: runLifecycleEvents.createdAt,
    })
    .from(runLifecycleEvents)
    .where(eq(runLifecycleEvents.workItemId, input.workItemId))
    .orderBy(desc(runLifecycleEvents.createdAt))
    .limit(input.limit ?? 50);

  return events;
}

export async function workItemsListRecentActivities(
  ctx: HandlerContext,
  input: { limit?: number; workspaceId?: string },
) {
  const limit = input.limit ?? 50;

  // When a workspace is given, scope the feed to that workspace's work items.
  // Activities have no workspaceId column, so resolve the workspace's work-item
  // ids first and filter on them. An empty workspace yields an empty feed
  // (instead of leaking other workspaces' activity).
  let workItemFilter: ReturnType<typeof inArray> | undefined;
  if (input.workspaceId) {
    await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);
    const wsItems = await ctx.db.query.workItems.findMany({
      where: eq(workItems.workspaceId, input.workspaceId),
      columns: { id: true },
    });
    const ids = wsItems.map((w) => w.id);
    if (ids.length === 0) return [];
    workItemFilter = inArray(activities.workItemId, ids);
  }

  const recentActivities = await ctx.db.query.activities.findMany({
    where: workItemFilter,
    orderBy: desc(activities.createdAt),
    limit,
    with: {
      workItem: {
        columns: {
          id: true,
          title: true,
          projectId: true,
          sequenceNumber: true,
        },
        with: {
          project: {
            columns: {
              id: true,
              key: true,
              name: true,
            },
          },
        },
      },
    },
  });

  const mappedActivities = recentActivities.map((activity) => ({
    ...activity,
    workItemTitle: activity.workItem.title,
    workItemIdentifier: formatWorkItemIdentifier({
      projectKey: activity.workItem.project?.key ?? null,
      sequenceNumber: activity.workItem.sequenceNumber,
      id: activity.workItem.id,
    }),
  }));

  if (mappedActivities.length >= limit) return mappedActivities;

  try {
    const recentRuns = await ctx.db.query.agentRuns.findMany({
      where: input.workspaceId
        ? and(
            eq(agentRuns.workspaceId, input.workspaceId),
            inArray(agentRuns.status, ["completed", "failed"]),
          )
        : inArray(agentRuns.status, ["completed", "failed"]),
      orderBy: desc(agentRuns.completedAt),
      limit: limit - mappedActivities.length,
    });

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const runWorkItemIds = recentRuns
      .map((r) => r.workItemId)
      .filter((id): id is string => typeof id === "string" && uuidRe.test(id));

    interface RunWorkItem {
      id: string;
      title: string;
      projectId: string | null;
      sequenceNumber: number;
      project: { id: string; key: string; name: string } | null;
    }
    const runWorkItems = new Map<string, RunWorkItem>();
    if (runWorkItemIds.length > 0) {
      const wiRows = await ctx.db.query.workItems.findMany({
        where: inArray(workItems.id, runWorkItemIds),
        columns: { id: true, title: true, projectId: true, sequenceNumber: true },
        with: { project: { columns: { id: true, key: true, name: true } } },
      });
      for (const wi of wiRows) runWorkItems.set(wi.id, wi);
    }

    const runActivities = recentRuns.map((run) => {
      const isUuid = Boolean(run.workItemId && uuidRe.test(run.workItemId));
      const wi = isUuid && run.workItemId ? runWorkItems.get(run.workItemId) : undefined;
      return {
        id: `run-${run.id}`,
        workItemId: isUuid ? (run.workItemId ?? null) : null,
        userId: null,
        type: run.status === "completed" ? "agent_completed" : "agent_failed",
        fromValue: "running",
        toValue: run.status,
        metadata: { agentType: run.agentType, sessionId: run.sessionId },
        createdAt: run.completedAt ?? run.createdAt,
        workItemTitle: wi?.title ?? (isUuid ? null : run.workItemId) ?? null,
        workItemIdentifier: wi
          ? formatWorkItemIdentifier({
              projectKey: wi.project?.key ?? null,
              sequenceNumber: wi.sequenceNumber,
              id: wi.id,
            })
          : null,
      };
    });

    const combined = [...mappedActivities, ...runActivities];
    combined.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return tb - ta;
    });

    return combined.slice(0, limit);
  } catch {
    return mappedActivities;
  }
}
