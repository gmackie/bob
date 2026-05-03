/**
 * Planning handler functions — pure business logic extracted from the tRPC
 * planning router.
 *
 * Phase 7B-4D-beta Task 9.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "@bob/db";
import { comments, projects, workItems, workspaceMembers } from "@bob/db/schema";

import { resolvePlanningProvider } from "../services/integrations/planningProvider.js";
import { onTaskStatusChange } from "../services/automation/task-trigger";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function assertWorkspaceAccess(db: any, userId: string, workspaceId: string) {
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

async function loadAccessibleProject(db: any, userId: string, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Project not found",
    });
  }

  await assertWorkspaceAccess(db, userId, project.workspaceId);
  return project;
}

async function loadAccessibleWorkItem(db: any, userId: string, workItemId: string) {
  const item = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
  });

  if (!item || !item.workspaceId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Task not found",
    });
  }

  await assertWorkspaceAccess(db, userId, item.workspaceId);
  return item;
}

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


// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function planningListWorkspaces(
  ctx: HandlerContext,
  _input: void,
) {
  const rows = await ctx.db.query.workspaceMembers.findMany({
    where: eq(workspaceMembers.userId, ctx.userId),
    with: {
      workspace: true,
    },
    orderBy: desc(workspaceMembers.joinedAt),
  });
  return rows.map((membership: any) => ({
    id: membership.workspace.id,
    name: membership.workspace.name,
    slug: membership.workspace.slug,
  }));
}

export async function planningListProjects(
  ctx: HandlerContext,
  input: { workspaceId: string },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  const projectRows = await ctx.db.query.projects.findMany({
    where: eq(projects.workspaceId, input.workspaceId),
    orderBy: desc(projects.updatedAt),
  });

  const items = await ctx.db.query.workItems.findMany({
    where: eq(workItems.workspaceId, input.workspaceId),
  });

  return projectRows.map((project: any) => {
    const projectItems = items.filter(
      (item: any) => item.projectId === project.id,
    );
    return {
      project: {
        id: project.id,
        name: project.name,
        key: project.key,
        status: project.status,
        color: project.color ?? "#6366f1",
      },
      issueCount: projectItems.length,
      completedCount: projectItems.filter(
        (item: any) => item.status === "done",
      ).length,
    };
  });
}

export async function planningGetProject(
  ctx: HandlerContext,
  input: { id: string },
) {
  const project = await loadAccessibleProject(ctx.db, ctx.userId, input.id);

  const items = await ctx.db.query.workItems.findMany({
    where: eq(workItems.projectId, input.id),
  });

  return {
    project: {
      id: project.id,
      name: project.name,
      key: project.key,
      description: project.description ?? undefined,
      status: project.status,
      color: project.color ?? "#6366f1",
    },
    issueCount: items.length,
    completedCount: items.filter((item: any) => item.status === "done").length,
    inProgressCount: items.filter(
      (item: any) =>
        item.status === "in_progress" || item.status === "in_review",
    ).length,
    backlogCount: items.filter((item: any) => item.status === "backlog")
      .length,
  };
}

export async function planningListTasks(
  ctx: HandlerContext,
  input: {
    workspaceId: string;
    projectId?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
    search?: string;
    limit?: number;
  },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);
  if (input.projectId) {
    const project = await loadAccessibleProject(
      ctx.db,
      ctx.userId,
      input.projectId,
    );
    if (project.workspaceId !== input.workspaceId) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
  }

  const {
    workspaceId,
    projectId,
    status,
    search,
    limit,
  } = input;

  const filters = [eq(workItems.workspaceId, workspaceId)];
  if (projectId) filters.push(eq(workItems.projectId, projectId));
  if (status) filters.push(eq(workItems.status, status));

  const items = await ctx.db.query.workItems.findMany({
    where: and(...filters),
    orderBy: desc(workItems.updatedAt),
    limit,
  });

  const filtered = search
    ? items.filter((item: any) =>
        item.title.toLowerCase().includes(search.toLowerCase()),
      )
    : items;

  const projectIds = Array.from(
    new Set(filtered.map((item: any) => item.projectId).filter(Boolean)),
  ) as string[];
  const projectRows =
    projectIds.length > 0
      ? await ctx.db.query.projects.findMany({
          where: eq(projects.workspaceId, workspaceId),
        })
      : [];
  const projectById = new Map(
    projectRows.map((p: any) => [p.id, p]),
  );

  return filtered.map((item: any) => {
    const project = item.projectId
      ? projectById.get(item.projectId) ?? null
      : null;
    return {
      id: item.id,
      identifier: formatWorkItemIdentifier({
        projectKey: project?.key ?? null,
        sequenceNumber: item.sequenceNumber,
        id: item.id,
      }),
      title: item.title,
      status: item.status,
      priority: "no_priority" as string,
      kind: item.kind,
      project: project
        ? { id: project.id, name: project.name, key: project.key }
        : undefined,
      assignee: undefined,
      labels: [] as Array<{ id: string; name: string; color: string }>,
      dueDate: undefined,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt ?? item.createdAt,
    };
  });
}

export async function planningGetTask(
  ctx: HandlerContext,
  input: { id: string },
) {
  // Try to find as internal work item first (backwards compat)
  const item = await ctx.db.query.workItems.findFirst({
    where: eq(workItems.id, input.id),
  });

  if (item && item.workspaceId) {
    await assertWorkspaceAccess(ctx.db, ctx.userId, item.workspaceId);

    const project = item.projectId
      ? await ctx.db.query.projects.findFirst({
          where: eq(projects.id, item.projectId),
        })
      : null;

    if (project && project.planningProvider === "linear" && project.linearProjectId) {
      const provider = await resolvePlanningProvider(ctx.db, project, project.workspaceId);
      const task = await provider.getTask(input.id);
      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found in Linear" });
      }
      return {
        id: task.externalId,
        identifier: task.identifier,
        title: task.title,
        description: task.description ?? undefined,
        status: task.status,
        priority: task.priority,
        labels: task.labels.map((l) => ({ id: l, name: l, color: "" })),
        dueDate: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // Internal provider path
    return {
      id: item.id,
      identifier: formatWorkItemIdentifier({
        projectKey: project?.key ?? null,
        sequenceNumber: item.sequenceNumber,
        id: item.id,
      }),
      title: item.title,
      description: item.description ?? undefined,
      status: item.status,
      priority: "no_priority" as string,
      project: project
        ? { id: project.id, name: project.name, key: project.key }
        : undefined,
      assignee: undefined,
      labels: [] as Array<{ id: string; name: string; color: string }>,
      dueDate: undefined,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt ?? item.createdAt,
      completedAt: undefined,
    };
  }

  throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
}

export async function planningGetTaskByIdentifier(
  ctx: HandlerContext,
  input: { identifier: string; workspaceId?: string },
) {
  if (input.workspaceId) {
    await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);
  }

  // Parse identifier like "PROJ-123"
  const match = input.identifier.match(/^([A-Z]+)-(\d+)$/);
  if (!match) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }

  const [, projectKey, seqStr] = match;
  const seqNum = parseInt(seqStr!, 10);

  const project = await ctx.db.query.projects.findFirst({
    where: eq(projects.key, projectKey!),
  });

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }

  if (input.workspaceId && project.workspaceId !== input.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }

  await assertWorkspaceAccess(ctx.db, ctx.userId, project.workspaceId);

  if (project.planningProvider === "linear" && project.linearProjectId) {
    const provider = await resolvePlanningProvider(ctx.db, project, project.workspaceId);
    const task = await provider.getTaskByIdentifier(input.identifier);
    if (!task) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
    }
    return {
      id: task.externalId,
      identifier: task.identifier,
      title: task.title,
      description: task.description ?? undefined,
      status: task.status,
      priority: task.priority,
      projectId: project.id,
      dueDate: undefined,
    };
  }

  // Internal path
  const item = await ctx.db.query.workItems.findFirst({
    where: and(
      eq(workItems.projectId, project.id),
      eq(workItems.sequenceNumber, seqNum),
    ),
  });

  if (!item) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }

  return {
    id: item.id,
    identifier: `${project.key}-${item.sequenceNumber}`,
    title: item.title,
    description: item.description ?? undefined,
    status: item.status,
    priority: "no_priority" as string,
    projectId: project.id,
    dueDate: undefined,
  };
}

export async function planningCreateTask(
  ctx: HandlerContext,
  input: {
    projectId: string;
    title: string;
    description?: string;
    kind?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
    labelIds?: string[];
    dueDate?: string;
  },
) {
  const project = await loadAccessibleProject(
    ctx.db,
    ctx.userId,
    input.projectId,
  );

  const provider = await resolvePlanningProvider(ctx.db, project, project.workspaceId);
  const result = await provider.createTask({
    title: input.title,
    description: input.description ?? null,
    providerProjectId: project.linearProjectId ?? project.id,
    priority: input.priority,
    assigneeId: input.assigneeId,
    labels: input.labelIds,
  });

  return {
    id: result.externalId,
    identifier: result.identifier,
    title: result.title,
    status: result.status,
    priority: result.priority,
  };
}

export async function planningUpdateTask(
  ctx: HandlerContext,
  input: {
    id: string;
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    assigneeId?: string | null;
    dueDate?: string | null;
  },
) {
  // Load item to find its project for provider resolution
  const oldItem = await ctx.db.query.workItems.findFirst({
    where: eq(workItems.id, input.id),
  });

  if (!oldItem || !oldItem.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }

  await assertWorkspaceAccess(ctx.db, ctx.userId, oldItem.workspaceId);

  const project = oldItem.projectId
    ? await ctx.db.query.projects.findFirst({
        where: eq(projects.id, oldItem.projectId),
      })
    : null;

  if (project && project.planningProvider === "linear" && project.linearProjectId) {
    const provider = await resolvePlanningProvider(ctx.db, project, project.workspaceId);
    const result = await provider.updateTask(input.id, {
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      assigneeId: input.assigneeId,
    });

    return {
      id: result.externalId,
      identifier: result.identifier,
      title: result.title,
      status: result.status,
      priority: result.priority,
    };
  }

  // Internal path
  const updateValues: Record<string, unknown> = {};
  if (input.title !== undefined) updateValues.title = input.title;
  if (input.description !== undefined) updateValues.description = input.description;
  if (input.status !== undefined) updateValues.status = input.status;

  const [updated] = await ctx.db
    .update(workItems)
    .set(updateValues)
    .where(eq(workItems.id, input.id))
    .returning();

  const identifier = formatWorkItemIdentifier({
    projectKey: project?.key ?? null,
    sequenceNumber: oldItem.sequenceNumber,
    id: oldItem.id,
  });

  if (input.status && oldItem.status !== input.status) {
    onTaskStatusChange({
      taskId: input.id,
      projectId: oldItem.projectId ?? null,
      oldStatus: oldItem.status,
      newStatus: input.status,
      userId: ctx.userId,
      identifier,
      title: oldItem.title,
    }).catch((err: any) =>
      console.error("[automation] task trigger failed:", err),
    );
  }

  return {
    id: updated!.id,
    identifier,
    title: updated!.title,
    status: updated!.status,
    priority: "no_priority" as string,
  };
}

export async function planningAddComment(
  ctx: HandlerContext,
  input: { issueId: string; body: string },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.issueId);

  const [comment] = await ctx.db
    .insert(comments)
    .values({
      workItemId: input.issueId,
      userId: ctx.userId,
      parentId: null,
      body: input.body,
      bodyHtml: null,
    })
    .returning();

  return {
    id: comment!.id,
    body: comment!.body,
    createdAt: comment!.createdAt,
  };
}

export async function planningListComments(
  ctx: HandlerContext,
  input: { issueId: string; includeReplies?: boolean },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.issueId);

  const rows = await ctx.db.query.comments.findMany({
    where: eq(comments.workItemId, input.issueId),
    orderBy: desc(comments.createdAt),
  });

  return rows.map((c: any) => ({
    id: c.id,
    body: c.body,
    user: undefined as { id: string; name: string } | undefined,
    createdAt: c.createdAt,
    replies: [] as Array<{
      id: string;
      body: string;
      user?: { id: string; name: string };
      createdAt: string;
    }>,
  }));
}

export async function planningSearchTasks(
  ctx: HandlerContext,
  input: { workspaceId: string; query: string; limit?: number },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  const searchPattern = `%${input.query}%`;
  const items = await ctx.db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.workspaceId, input.workspaceId),
        sql`${workItems.title} ILIKE ${searchPattern}`,
      ),
    )
    .orderBy(desc(workItems.updatedAt))
    .limit(input.limit ?? 20);

  const projectIds = Array.from(
    new Set(items.map((item: any) => item.projectId).filter(Boolean)),
  ) as string[];
  const projectRows =
    projectIds.length > 0
      ? await ctx.db.query.projects.findMany({
          where: eq(projects.workspaceId, input.workspaceId),
        })
      : [];
  const projectById = new Map(
    projectRows.map((p: any) => [p.id, p]),
  );

  return items.map((item: any) => {
    const project = item.projectId
      ? projectById.get(item.projectId) ?? null
      : null;
    return {
      id: item.id,
      identifier: formatWorkItemIdentifier({
        projectKey: project?.key ?? null,
        sequenceNumber: item.sequenceNumber,
        id: item.id,
      }),
      title: item.title,
      status: item.status,
      priority: "no_priority" as string,
      project: project
        ? { id: project.id, name: project.name }
        : undefined,
      assignee: undefined,
    };
  });
}

export async function planningListLabels(
  ctx: HandlerContext,
  input: { workspaceId: string },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);
  return [];
}

export async function planningListCycles(
  ctx: HandlerContext,
  input: { workspaceId: string; status?: string },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);
  return [];
}

/**
 * The session type needed by getCurrentUser — carries the full user record
 * rather than just `user.id`.
 */
interface GetCurrentUserContext {
  readonly db: any;
  readonly userId: string;
  readonly session: {
    user: { id: string; email: string; name: string; image?: string | null };
  };
}

export async function planningGetCurrentUser(
  ctx: GetCurrentUserContext,
  _input: void,
) {
  const user = ctx.session.user;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.image ?? undefined,
  };
}

export async function planningAgentClaimTask(
  ctx: HandlerContext,
  input: { agentId: string; issueId: string; sessionId?: string },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.issueId);

  return {
    id: input.issueId,
    issueId: input.issueId,
    status: "claimed",
    claimedAt: new Date().toISOString(),
  };
}

export async function planningAgentReportProgress(
  _ctx: HandlerContext,
  input: { taskRunId: string; progress: string },
) {
  return {
    id: input.taskRunId,
    status: "in_progress",
  };
}

export async function planningAgentCompleteTask(
  _ctx: HandlerContext,
  input: {
    taskRunId: string;
    summary?: string;
    artifacts?: Array<{
      type: "pr" | "commit" | "file" | "comment";
      url?: string;
      description?: string;
    }>;
    markIssueDone?: boolean;
  },
) {
  return {
    id: input.taskRunId,
    status: "completed",
    completedAt: new Date().toISOString(),
  };
}

export async function planningAgentFailTask(
  _ctx: HandlerContext,
  input: {
    taskRunId: string;
    errorCode: string;
    errorMessage: string;
    recoverable?: boolean;
    returnToBacklog?: boolean;
  },
) {
  return {
    id: input.taskRunId,
    status: "failed",
  };
}

export async function planningAgentGetAvailableTasks(
  ctx: HandlerContext,
  input: { agentId: string; workspaceId: string; limit?: number },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);
  return [];
}

export async function planningAgentStartSession(
  ctx: HandlerContext,
  input: { agentId: string; workspaceId: string; clientInfo?: string },
) {
  await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);

  return {
    id: input.agentId,
    startedAt: new Date().toISOString(),
  };
}

export async function planningAgentEndSession(
  _ctx: HandlerContext,
  input: { sessionId: string },
) {
  return {
    id: input.sessionId,
    endedAt: new Date().toISOString(),
  };
}
