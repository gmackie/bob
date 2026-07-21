/**
 * Plan session handler functions — pure business logic extracted from the tRPC
 * planSession router.
 *
 * Phase 7B-4D-beta Task 8.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, ne } from "@bob/db";
import type { Db } from "@bob/db/client";
import {
  agentPersonas,
  chatConversations,
  planDraftDependencies,
  planDrafts,
  planningSessionMessages,
  projects,
  repositories,
  runLifecycleEvents,
  user,
  workItemArtifacts,
  workItemDependencies,
  workItems,
  workspaceMembers,
} from "@bob/db/schema";
import type { WorkItemKind } from "@bob/db/schema";

import { resolvePlanningProvider } from "../services/integrations/planningProvider.js";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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
    console.warn("[planSession] workspace event notification failed:", err);
  }
}

async function loadAccessibleWorkItem(db: Db, userId: string, workItemId: string) {
  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
  });

  if (!workItem?.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await assertWorkspaceAccess(db, userId, workItem.workspaceId);
  return workItem;
}

/**
 * Load a planning session the caller can collaborate on.
 * Access: session owner OR workspace member (via planningWorkspaceId or work item workspace).
 */
async function loadAccessiblePlanningSession(
  db: Db,
  userId: string,
  sessionId: string,
) {
  const session = await db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, sessionId),
      eq(chatConversations.sessionType, "planning"),
    ),
  });

  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  if (session.userId === userId) {
    return session;
  }

  let workspaceId = session.planningWorkspaceId ?? null;
  if (!workspaceId && session.workItemId) {
    const workItem = await db.query.workItems.findFirst({
      where: eq(workItems.id, session.workItemId),
      columns: { workspaceId: true },
    });
    workspaceId = workItem?.workspaceId ?? null;
  }

  if (!workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await assertWorkspaceAccess(db, userId, workspaceId);
  return session;
}

/** Alias — collaborators may mutate drafts, not only the session owner. */
const loadOwnedPlanningSession = loadAccessiblePlanningSession;

async function loadOwnedDraft(db: Db, userId: string, draftId: string) {
  const draft = await db.query.planDrafts.findFirst({
    where: eq(planDrafts.id, draftId),
  });

  if (!draft) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await loadAccessiblePlanningSession(db, userId, draft.sessionId);
  return draft;
}

async function notifyPlanningDraftsChanged(input: {
  action: "created" | "updated" | "removed" | "dependency_added" | "dependency_removed";
  workspaceId?: string | null;
  sessionId?: string | null;
  projectId?: string | null;
  draftIds: string[];
}) {
  if (!input.workspaceId || !input.sessionId) return;

  await notifyWorkspaceEvent({
    type: "planning_session_produced_drafts",
    workspaceId: input.workspaceId,
    entityId: input.sessionId,
    payload: {
      action: input.action,
      draftIds: input.draftIds,
      projectId: input.projectId ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function planSessionCreate(
  ctx: HandlerContext,
  input: {
    workspaceId?: string;
    projectId?: string;
    workingDirectory?: string;
    title?: string;
    workItemId?: string;
    planningSessionType?: string;
  },
) {
  // If workItemId is provided, look up workspace/project from the work item
  let resolvedWorkItemId = input.workItemId ?? null;

  if (input.workItemId) {
    const wi = await loadAccessibleWorkItem(
      ctx.db,
      ctx.userId,
      input.workItemId,
    );
    resolvedWorkItemId = wi.id;
  }

  // Resolve working directory from mapped repository if not explicitly provided
  let workingDirectory = input.workingDirectory ?? "/";
  if (workingDirectory === "/" && input.projectId) {
    const repo = await ctx.db.query.repositories.findFirst({
      where: eq(repositories.planningProjectId, input.projectId),
      columns: { path: true },
    });
    if (repo?.path) {
      workingDirectory = repo.path;
      console.log(`[planSession] Resolved working directory from repo: ${repo.path}`);
    }
  }

  const [session] = await ctx.db
    .insert(chatConversations)
    .values({
      userId: ctx.userId,
      workingDirectory,
      agentType: "claude",
      sessionType: "planning",
      title: input.title ?? "Planning session",
      status: "provisioning",
      workItemId: resolvedWorkItemId,
      planningSessionType: input.planningSessionType ?? null,
    })
    .returning();

  if (!session) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create planning session",
    });
  }

  return session;
}

export async function planSessionStart(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    workspaceId: string;
    projectId: string;
    projectName: string;
    workingDirectory: string;
    launchContext?: {
      intent: "shape" | "breakdown";
      notes: string;
      workItem?: {
        id: string;
        identifier: string;
        title: string;
        kind: string;
      };
      selectedRepoSources: {
        id: string;
        label: string;
        path: string;
        detail: string;
      }[];
      attachedFiles: {
        name: string;
        sizeLabel: string;
        content?: string;
      }[];
    };
  },
) {
  await loadOwnedPlanningSession(ctx.db, ctx.userId, input.sessionId);

  // Resolve Planner persona by slug (graceful fallback if not found)
  const [plannerPersona] = await ctx.db
    .select()
    .from(agentPersonas)
    .where(
      and(
        eq(agentPersonas.slug, "planner"),
        eq(agentPersonas.active, true),
      ),
    )
    .limit(1);

  const agentType = plannerPersona?.adapterId ?? "claude";
  const personaConfig = plannerPersona
    ? {
        model: plannerPersona.model as string | undefined,
        systemPrompt: plannerPersona.systemPrompt as string | undefined,
        allowedTools: plannerPersona.allowedTools as string[] | undefined,
        autonomyLevel: plannerPersona.autonomyLevel as string | undefined,
        metadata: plannerPersona.metadata as Record<string, unknown> | undefined,
      }
    : undefined;

  await ctx.db
    .update(chatConversations)
    .set({
      status: "pending",
      workingDirectory: input.workingDirectory,
      agentType,
      planningWorkspaceId: input.workspaceId,
      planningProjectId: input.projectId,
      planningProjectName: input.projectName,
      planningLaunchContext: input.launchContext ?? null,
      ...(plannerPersona ? { personaId: plannerPersona.id, personaMetadata: personaConfig } : {}),
    })
    .where(eq(chatConversations.id, input.sessionId));

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
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          workingDirectory: input.workingDirectory,
          agentType,
          title: "Planning session",
          sessionType: "planning",
          personaId: plannerPersona?.id,
          personaConfig,
          planningContext: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            projectName: input.projectName,
            launchContext: input.launchContext,
          },
        }),
      });
    } catch (err) {
      console.warn("[planSession.start] nudge failed:", err);
    }
  }

  return { ok: true, sessionId: input.sessionId };
}

export async function planSessionGet(
  ctx: HandlerContext,
  input: { sessionId: string },
) {
  let session;
  try {
    session = await loadAccessiblePlanningSession(
      ctx.db,
      ctx.userId,
      input.sessionId,
    );
  } catch {
    return null;
  }

  const drafts = await ctx.db.query.planDrafts.findMany({
    where: eq(planDrafts.sessionId, input.sessionId),
    orderBy: [planDrafts.sortOrder, planDrafts.createdAt],
  });

  const draftIds = drafts.map((d) => d.id);

  const deps =
    draftIds.length > 0
      ? await ctx.db.query.planDraftDependencies.findMany({
          where: inArray(planDraftDependencies.draftId, draftIds),
        })
      : [];

  return { session, drafts, dependencies: deps };
}

export async function planSessionList(
  ctx: HandlerContext,
  input: {
    workspaceId?: string;
    limit: number;
  },
) {
  // Workspace-scoped lists include every collaborator's planning sessions.
  // Without a workspace filter, keep the legacy "mine only" behavior.
  if (input.workspaceId) {
    await assertWorkspaceAccess(ctx.db, ctx.userId, input.workspaceId);
  }

  const conditions = [eq(chatConversations.sessionType, "planning")];

  if (input.workspaceId) {
    conditions.push(eq(chatConversations.planningWorkspaceId, input.workspaceId));
  } else {
    conditions.push(eq(chatConversations.userId, ctx.userId));
  }

  const sessions = await ctx.db.query.chatConversations.findMany({
    where: and(...conditions),
    orderBy: desc(chatConversations.createdAt),
    limit: input.limit,
  });

  const sessionIds = sessions.map((session) => session.id);
  if (sessionIds.length === 0) return sessions;

  const drafts = await ctx.db.query.planDrafts.findMany({
    where: inArray(planDrafts.sessionId, sessionIds),
    columns: {
      id: true,
      sessionId: true,
      status: true,
    },
  });
  const countsBySession = new Map<string, { draftCount: number; producedTaskCount: number }>();

  for (const draft of drafts as { sessionId: string; status: string }[]) {
    const counts = countsBySession.get(draft.sessionId) ?? {
      draftCount: 0,
      producedTaskCount: 0,
    };

    if (draft.status === "committed") {
      counts.producedTaskCount += 1;
    } else if (draft.status === "draft") {
      counts.draftCount += 1;
    }

    countsBySession.set(draft.sessionId, counts);
  }

  return sessions.map((session) => ({
    ...session,
    draftCount: countsBySession.get(session.id)?.draftCount ?? 0,
    producedTaskCount: countsBySession.get(session.id)?.producedTaskCount ?? 0,
  }));
}

export async function planSessionListByWorkItem(
  ctx: HandlerContext,
  input: {
    workItemId: string;
    limit: number;
  },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  const sessions = await ctx.db.query.chatConversations.findMany({
    where: and(
      eq(chatConversations.sessionType, "planning"),
      eq(chatConversations.workItemId, input.workItemId),
    ),
    orderBy: desc(chatConversations.createdAt),
    limit: input.limit,
  });

  return sessions;
}

export async function planSessionGetActiveForWorkItem(
  ctx: HandlerContext,
  input: { workItemId: string },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.sessionType, "planning"),
      eq(chatConversations.workItemId, input.workItemId),
      ne(chatConversations.status, "stopped"),
    ),
    orderBy: desc(chatConversations.createdAt),
  });

  return session ?? null;
}

export async function planSessionSaveArtifact(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    workItemId: string;
    title: string;
    content: string;
    planningSessionType?: string;
  },
) {
  await loadAccessiblePlanningSession(ctx.db, ctx.userId, input.sessionId);
  const workItem = await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  const [artifact] = await ctx.db
    .insert(workItemArtifacts)
    .values({
      workItemId: input.workItemId,
      sessionId: input.sessionId,
      artifactType: "planning_doc",
      artifactRole: input.planningSessionType ?? "planning",
      producerType: "bob",
      title: input.title,
      content: input.content,
      isCurrent: true,
      contentVersion: 1,
      lastEditedByUserId: ctx.userId,
      updatedAt: new Date().toISOString(),
    })
    .returning();

  if (!artifact) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create planning artifact",
    });
  }

  if (workItem.workspaceId) {
    await notifyWorkspaceEvent({
      type: "planning_artifact_updated",
      workspaceId: workItem.workspaceId,
      entityId: input.sessionId,
      payload: {
        action: "created",
        artifactId: artifact.id,
        workItemId: input.workItemId,
        contentVersion: artifact.contentVersion,
        lastEditedByUserId: ctx.userId,
      },
    });
  }

  return artifact;
}

export async function planSessionUpdateArtifact(
  ctx: HandlerContext,
  input: {
    artifactId: string;
    content: string;
    title?: string;
    expectedVersion?: number;
  },
) {
  const existing = await ctx.db.query.workItemArtifacts.findFirst({
    where: eq(workItemArtifacts.id, input.artifactId),
  });

  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Artifact not found" });
  }

  const workItem = await loadAccessibleWorkItem(
    ctx.db,
    ctx.userId,
    existing.workItemId,
  );

  if (existing.sessionId) {
    await loadAccessiblePlanningSession(ctx.db, ctx.userId, existing.sessionId);
  }

  if (
    input.expectedVersion != null &&
    existing.contentVersion !== input.expectedVersion
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Artifact was modified (version ${existing.contentVersion}, expected ${input.expectedVersion})`,
    });
  }

  const nextVersion = existing.contentVersion + 1;
  const [artifact] = await ctx.db
    .update(workItemArtifacts)
    .set({
      content: input.content,
      ...(input.title !== undefined ? { title: input.title } : {}),
      contentVersion: nextVersion,
      lastEditedByUserId: ctx.userId,
      updatedAt: new Date().toISOString(),
      producerType: "human",
    })
    .where(eq(workItemArtifacts.id, input.artifactId))
    .returning();

  if (!artifact) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update planning artifact",
    });
  }

  if (workItem.workspaceId) {
    await notifyWorkspaceEvent({
      type: "planning_artifact_updated",
      workspaceId: workItem.workspaceId,
      entityId: existing.sessionId ?? undefined,
      payload: {
        action: "updated",
        artifactId: artifact.id,
        workItemId: existing.workItemId,
        contentVersion: nextVersion,
        lastEditedByUserId: ctx.userId,
        content: input.content,
        title: artifact.title,
      },
    });
  }

  return artifact;
}

export async function planSessionListArtifacts(
  ctx: HandlerContext,
  input: { sessionId: string },
) {
  await loadAccessiblePlanningSession(ctx.db, ctx.userId, input.sessionId);

  return ctx.db.query.workItemArtifacts.findMany({
    where: and(
      eq(workItemArtifacts.sessionId, input.sessionId),
      eq(workItemArtifacts.artifactType, "planning_doc"),
    ),
    orderBy: desc(workItemArtifacts.createdAt),
  });
}

export async function planSessionListMessages(
  ctx: HandlerContext,
  input: { sessionId: string; limit?: number },
) {
  await loadAccessiblePlanningSession(ctx.db, ctx.userId, input.sessionId);
  const limit = input.limit ?? 100;

  const rows = await ctx.db
    .select({
      id: planningSessionMessages.id,
      sessionId: planningSessionMessages.sessionId,
      userId: planningSessionMessages.userId,
      clientMessageId: planningSessionMessages.clientMessageId,
      body: planningSessionMessages.body,
      createdAt: planningSessionMessages.createdAt,
      userName: user.name,
      userImage: user.image,
    })
    .from(planningSessionMessages)
    .leftJoin(user, eq(user.id, planningSessionMessages.userId))
    .where(eq(planningSessionMessages.sessionId, input.sessionId))
    .orderBy(desc(planningSessionMessages.createdAt))
    .limit(limit);

  return rows.reverse();
}

export async function planSessionSendMessage(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    body: string;
    clientMessageId?: string;
  },
) {
  const session = await loadAccessiblePlanningSession(
    ctx.db,
    ctx.userId,
    input.sessionId,
  );

  const body = input.body.trim();
  if (!body) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Message body is required",
    });
  }
  if (body.length > 4000) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Message body must be at most 4000 characters",
    });
  }

  if (input.clientMessageId) {
    const existing = await ctx.db.query.planningSessionMessages.findFirst({
      where: and(
        eq(planningSessionMessages.sessionId, input.sessionId),
        eq(planningSessionMessages.userId, ctx.userId),
        eq(planningSessionMessages.clientMessageId, input.clientMessageId),
      ),
    });
    if (existing) {
      const [author] = await ctx.db
        .select({ name: user.name, image: user.image })
        .from(user)
        .where(eq(user.id, ctx.userId))
        .limit(1);
      return {
        ...existing,
        userName: author?.name ?? null,
        userImage: author?.image ?? null,
      };
    }
  }

  const [message] = await ctx.db
    .insert(planningSessionMessages)
    .values({
      sessionId: input.sessionId,
      userId: ctx.userId,
      clientMessageId: input.clientMessageId ?? null,
      body,
    })
    .returning();

  if (!message) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to send message",
    });
  }

  const [author] = await ctx.db
    .select({ name: user.name, image: user.image })
    .from(user)
    .where(eq(user.id, ctx.userId))
    .limit(1);

  const result = {
    ...message,
    userName: author?.name ?? null,
    userImage: author?.image ?? null,
  };

  const workspaceId = session.planningWorkspaceId;
  if (workspaceId) {
    await notifyWorkspaceEvent({
      type: "planning_collab_message",
      workspaceId,
      entityId: input.sessionId,
      payload: {
        message: result,
      },
    });
  }

  return result;
}

export async function planSessionGetPriorContext(
  ctx: HandlerContext,
  input: {
    workItemId: string;
    excludeSessionId?: string;
    maxChars: number;
  },
) {
  await loadAccessibleWorkItem(ctx.db, ctx.userId, input.workItemId);

  const conditions = [
    eq(workItemArtifacts.workItemId, input.workItemId),
    eq(workItemArtifacts.artifactType, "planning_doc"),
    eq(workItemArtifacts.isCurrent, true),
  ];

  if (input.excludeSessionId) {
    conditions.push(
      ne(workItemArtifacts.sessionId, input.excludeSessionId),
    );
  }

  const artifacts = await ctx.db.query.workItemArtifacts.findMany({
    where: and(...conditions),
    orderBy: desc(workItemArtifacts.createdAt),
  });

  // Truncate content to fit within the total character budget
  let remainingChars = input.maxChars;
  const result: {
    id: string;
    title: string | null;
    sessionId: string | null;
    content: string | null;
    createdAt: string;
  }[] = [];

  for (const artifact of artifacts) {
    if (remainingChars <= 0) break;

    const content = artifact.content ?? "";
    const truncatedContent =
      content.length > remainingChars
        ? content.slice(0, remainingChars)
        : content;
    remainingChars -= truncatedContent.length;

    result.push({
      id: artifact.id,
      title: artifact.title,
      sessionId: artifact.sessionId,
      content: truncatedContent,
      createdAt: artifact.createdAt,
    });
  }

  return result;
}

// --- Draft CRUD ---

export async function planSessionCreateDraft(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    workspaceId: string;
    projectId: string;
    title: string;
    description?: string;
    kind: WorkItemKind;
    priority: string;
    sortOrder: number;
  },
) {
  await loadOwnedPlanningSession(ctx.db, ctx.userId, input.sessionId);

  const [draft] = await ctx.db
    .insert(planDrafts)
    .values({
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      kind: input.kind,
      priority: input.priority,
      sortOrder: input.sortOrder,
    })
    .returning();

  if (!draft) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create plan draft",
    });
  }

  console.log(
    `[planning] Draft created: "${input.title}" (${input.kind}) in session ${input.sessionId}`,
  );

  await notifyPlanningDraftsChanged({
    action: "created",
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    projectId: input.projectId,
    draftIds: [draft.id],
  });

  return draft;
}

export async function planSessionUpdateDraft(
  ctx: HandlerContext,
  input: {
    id: string;
    title?: string;
    description?: string;
    kind?: WorkItemKind;
    priority?: string;
    sortOrder?: number;
  },
) {
  const { id, ...updates } = input;
  await loadOwnedDraft(ctx.db, ctx.userId, id);

  const [draft] = await ctx.db
    .update(planDrafts)
    .set(updates)
    .where(eq(planDrafts.id, id))
    .returning();

  if (!draft) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update plan draft",
    });
  }

  await notifyPlanningDraftsChanged({
    action: "updated",
    workspaceId: draft.workspaceId,
    sessionId: draft.sessionId,
    projectId: draft.projectId,
    draftIds: [id],
  });

  return draft;
}

export async function planSessionRemoveDraft(
  ctx: HandlerContext,
  input: { id: string },
) {
  const draft = await loadOwnedDraft(ctx.db, ctx.userId, input.id);

  await ctx.db.delete(planDrafts).where(eq(planDrafts.id, input.id));
  await notifyPlanningDraftsChanged({
    action: "removed",
    workspaceId: draft.workspaceId,
    sessionId: draft.sessionId,
    projectId: draft.projectId,
    draftIds: [input.id],
  });

  return { ok: true };
}

export async function planSessionSetDependency(
  ctx: HandlerContext,
  input: {
    draftId: string;
    dependsOnDraftId: string;
  },
) {
  const draft = await loadOwnedDraft(ctx.db, ctx.userId, input.draftId);
  await loadOwnedDraft(ctx.db, ctx.userId, input.dependsOnDraftId);

  const [dep] = await ctx.db
    .insert(planDraftDependencies)
    .values({
      draftId: input.draftId,
      dependsOnDraftId: input.dependsOnDraftId,
    })
    .returning();

  if (!dep) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create draft dependency",
    });
  }

  console.log(
    `[planning] Dependency set: ${input.draftId} depends on ${input.dependsOnDraftId}`,
  );

  await notifyPlanningDraftsChanged({
    action: "dependency_added",
    workspaceId: draft.workspaceId,
    sessionId: draft.sessionId,
    projectId: draft.projectId,
    draftIds: [input.draftId, input.dependsOnDraftId],
  });

  return dep;
}

export async function planSessionRemoveDependency(
  ctx: HandlerContext,
  input: {
    draftId: string;
    dependsOnDraftId: string;
  },
) {
  const draft = await loadOwnedDraft(ctx.db, ctx.userId, input.draftId);
  await loadOwnedDraft(ctx.db, ctx.userId, input.dependsOnDraftId);

  await ctx.db
    .delete(planDraftDependencies)
    .where(
      and(
        eq(planDraftDependencies.draftId, input.draftId),
        eq(
          planDraftDependencies.dependsOnDraftId,
          input.dependsOnDraftId,
        ),
      ),
    );
  await notifyPlanningDraftsChanged({
    action: "dependency_removed",
    workspaceId: draft.workspaceId,
    sessionId: draft.sessionId,
    projectId: draft.projectId,
    draftIds: [input.draftId, input.dependsOnDraftId],
  });

  return { ok: true };
}

export async function planSessionCommitPlan(
  ctx: HandlerContext,
  input: { sessionId: string },
) {
  await loadOwnedPlanningSession(ctx.db, ctx.userId, input.sessionId);

  const drafts = await ctx.db.query.planDrafts.findMany({
    where: and(
      eq(planDrafts.sessionId, input.sessionId),
      eq(planDrafts.status, "draft"),
    ),
    orderBy: [planDrafts.sortOrder, planDrafts.createdAt],
  });

  if (drafts.length === 0) {
    return { committed: 0, tasks: [] };
  }

  const createdTasks: {
    draftId: string;
    taskId: string;
    identifier: string;
    workspaceId: string;
  }[] = [];

  for (const draft of drafts) {
    try {
      const project = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, draft.projectId),
      });

      if (!project) {
        console.error(`[planSession] Project not found for draft ${draft.id}`);
        continue;
      }

      const provider = await resolvePlanningProvider(ctx.db, project, project.workspaceId);
      const result = await provider.createTask({
        title: draft.title,
        description: draft.description ?? null,
        providerProjectId: project.linearProjectId ?? project.id,
        priority: draft.priority,
      });

      createdTasks.push({
        draftId: draft.id,
        taskId: result.externalId,
        identifier: result.identifier,
        workspaceId: project.workspaceId,
      });
    } catch (err) {
      console.error(
        `[planSession] Failed to create task for draft ${draft.id}:`,
        err,
      );
    }
  }

  const [firstCreatedTask] = createdTasks;
  if (firstCreatedTask) {
    const committedIds = createdTasks.map((t) => t.draftId);
    await ctx.db
      .update(planDrafts)
      .set({ status: "committed" })
      .where(inArray(planDrafts.id, committedIds));

    await notifyWorkspaceEvent({
      type: "planning_session_produced_tasks",
      workspaceId: firstCreatedTask.workspaceId,
      entityId: input.sessionId,
      payload: {
        committed: createdTasks.length,
        taskIds: createdTasks.map((task) => task.taskId),
        draftIds: committedIds,
      },
    });
  }

  return {
    committed: createdTasks.length,
    tasks: createdTasks.map(({ workspaceId: _workspaceId, ...task }) => task),
  };
}

export async function planSessionCommitPlanLocal(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    parentWorkItemId: string;
  },
) {
  const drafts = await ctx.db.query.planDrafts.findMany({
    where: and(
      eq(planDrafts.sessionId, input.sessionId),
      eq(planDrafts.status, "draft"),
    ),
    orderBy: [planDrafts.sortOrder, planDrafts.createdAt],
  });

  if (drafts.length === 0) {
    return { committed: 0, workItems: [], dependencies: 0 };
  }

  // Get parent work item for workspace/project context
  const parentWI = await ctx.db.query.workItems.findFirst({
    where: eq(workItems.id, input.parentWorkItemId),
  });
  if (!parentWI) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Parent work item not found",
    });
  }

  // Fetch draft dependencies
  const draftIds = drafts.map((d) => d.id);
  const draftDeps =
    draftIds.length > 0
      ? await ctx.db.query.planDraftDependencies.findMany({
          where: inArray(planDraftDependencies.draftId, draftIds),
        })
      : [];

  // Cycle detection via topological sort
  if (draftDeps.length > 0) {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();
    for (const id of draftIds) {
      inDegree.set(id, 0);
      adjList.set(id, []);
    }
    for (const dep of draftDeps) {
      // dep.draftId depends on dep.dependsOnDraftId
      // Edge: dependsOnDraftId → draftId (must complete before)
      adjList.get(dep.dependsOnDraftId)?.push(dep.draftId);
      inDegree.set(dep.draftId, (inDegree.get(dep.draftId) ?? 0) + 1);
    }
    const queue = draftIds.filter((id: string) => (inDegree.get(id) ?? 0) === 0);
    let visited = 0;
    for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
      visited++;
      for (const neighbor of adjList.get(node) ?? []) {
        const deg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) queue.push(neighbor);
      }
    }
    if (visited < draftIds.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Cyclic dependencies detected in plan drafts. Remove circular dependencies before committing.",
      });
    }
  }

  console.log(
    `[planning] Committing plan: ${drafts.length} drafts, ${draftDeps.length} dependencies in session ${input.sessionId}`,
  );

  // ── Local DB path ─────────────────────────────────────────────
  // All DB writes in a single transaction
  const result = await ctx.db.transaction(async (tx) => {
    // Batch insert all work items (epics first for ordering, but all under same parent)
    const sorted = [
      ...drafts.filter((d) => d.kind === "epic"),
      ...drafts.filter((d) => d.kind !== "epic"),
    ];

    const workItemValues = sorted.map((draft) => ({
      ownerUserId: ctx.userId,
      workspaceId: parentWI.workspaceId,
      projectId: parentWI.projectId,
      parentId: input.parentWorkItemId,
      kind: draft.kind,
      title: draft.title,
      description: draft.description,
      status: "todo" as const,
    }));

    const createdRows = await tx
      .insert(workItems)
      .values(workItemValues)
      .returning({ id: workItems.id, title: workItems.title });

    if (createdRows.length !== sorted.length) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Work item batch insert returned an unexpected row count",
      });
    }

    // Build draftId → workItemId map
    const draftToWorkItem = new Map<string, string>();
    const created: {
      draftId: string;
      workItemId: string;
      title: string;
    }[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const draft = sorted[i];
      const row = createdRows[i];
      if (!draft || !row) continue;
      draftToWorkItem.set(draft.id, row.id);
      created.push({
        draftId: draft.id,
        workItemId: row.id,
        title: row.title,
      });
    }

    // Persist dependencies as work_item_dependencies
    let depCount = 0;
    if (draftDeps.length > 0) {
      const depValues = draftDeps
        .map((dep) => {
          const workItemId = draftToWorkItem.get(dep.draftId);
          const dependsOnWorkItemId = draftToWorkItem.get(
            dep.dependsOnDraftId,
          );
          if (!workItemId || !dependsOnWorkItemId) return null;
          return { workItemId, dependsOnWorkItemId };
        })
        .filter(
          (v): v is { workItemId: string; dependsOnWorkItemId: string } =>
            v !== null,
        );

      if (depValues.length > 0) {
        await tx.insert(workItemDependencies).values(depValues);
        depCount = depValues.length;
      }
    }

    // Mark drafts as committed
    const committedIds = created.map((c) => c.draftId);
    await tx
      .update(planDrafts)
      .set({ status: "committed" })
      .where(inArray(planDrafts.id, committedIds));

    return { created, depCount };
  });

  console.log(
    `[planning] Plan committed: ${result.created.length} work items, ${result.depCount} dependencies`,
  );

  // Fire-and-forget lifecycle event
  void ctx.db
    .insert(runLifecycleEvents)
    .values({
      taskRunId: `plan-commit-${input.sessionId}`,
      workItemId: input.parentWorkItemId,
      sessionId: input.sessionId,
      eventType: "plan_approved",
      phase: "plan",
      metadata: {
        committed: result.created.length,
        dependencies: result.depCount,
      },
    })
    .catch((err: unknown) =>
      console.error("[planning] Failed to log lifecycle event:", err),
    );

  return {
    committed: result.created.length,
    workItems: result.created,
    dependencies: result.depCount,
  };
}
