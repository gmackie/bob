/**
 * Session handler functions — pure business logic extracted from the tRPC
 * session router.
 *
 * Phase 7B-4D-beta Task 10.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, inArray, lt, sql } from "@bob/db";
import {
  agentPersonas,
  chatConversations,
  sessionConnections,
  sessionEvents,
  taskRuns,
  workItems,
} from "@bob/db/schema";

import type { WorkflowStatus } from "../services/sessions/workflowStatusService";
import type { ElevenLabsSessionService } from "../services/voice/elevenlabsSession";
import {
  completeTask,
  getSessionWorkflowState,
  linkTaskArtifact,
  markTaskReviewReady,
  recordVerificationResult,
  reportTaskProgress,
  reportWorkflowStatus,
  requestInput,
  resolveAwaitingInput,
  workflowStatusValues,
} from "../services/sessions/workflowStatusService";
import { createElevenLabsSessionService } from "../services/voice/elevenlabsSession";
import { createOpenCodeClient } from "../services/opencode/opencodeClient";
function buildWorkItemUrl(workItemId: string | null | undefined): string | null {
  if (!workItemId) return null;
  return `/work-items/${workItemId}`;
}

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helpers (moved verbatim from the router)
// ---------------------------------------------------------------------------

function getGatewayUrl() {
  return process.env.GATEWAY_URL ?? "http://localhost:3002";
}
function getGatewayPublicUrl() {
  return process.env.GATEWAY_PUBLIC_URL ?? getGatewayUrl();
}
export const getGatewaySocketUrl = (): string =>
  `${getGatewayPublicUrl().replace(/^http/, "ws")}/sessions`;

// Initialize ElevenLabs session service (singleton)
let elevenlabsService: ElevenLabsSessionService | null = null;
function getElevenLabsService(): ElevenLabsSessionService | null {
  if (!elevenlabsService) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;

    if (!apiKey || !agentId) {
      console.warn(
        "[Session] ElevenLabs not configured: ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID required",
      );
      return null;
    }

    elevenlabsService = createElevenLabsSessionService({
      apiKey,
      agentId,
    });
  }
  return elevenlabsService;
}

const sessionStatusValues = [
  "provisioning",
  "starting",
  "running",
  "idle",
  "stopping",
  "stopped",
  "error",
] as const;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

// ---------------------------------------------------------------------------
// Persona resolution
// ---------------------------------------------------------------------------

async function resolvePersonaDefaults(
  ctx: HandlerContext,
  input: { agentType?: string; personaId?: string },
) {
  if (!input.personaId) {
    return {
      agentType: input.agentType ?? "opencode",
      personaId: null as string | null,
      personaMetadata: null as Record<string, unknown> | null,
    };
  }

  const [persona] = await ctx.db
    .select()
    .from(agentPersonas)
    .where(eq(agentPersonas.id, input.personaId))
    .limit(1);

  if (!persona) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Persona ${input.personaId} not found`,
    });
  }

  return {
    agentType: input.agentType ?? persona.adapterId,
    personaId: persona.id,
    personaMetadata: {
      personaSlug: persona.slug,
      personaName: persona.name,
      model: persona.model,
      systemPrompt: persona.systemPrompt,
      allowedTools: persona.allowedTools,
      autonomyLevel: persona.autonomyLevel,
      ...persona.metadata,
    },
  };
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function sessionList(
  ctx: HandlerContext,
  input: {
    repositoryId?: string;
    worktreeId?: string;
    status?: (typeof sessionStatusValues)[number];
    limit: number;
    cursor?: string;
  },
) {
  const conditions = [eq(chatConversations.userId, ctx.userId)];

  if (input.repositoryId) {
    conditions.push(eq(chatConversations.repositoryId, input.repositoryId));
  }
  if (input.worktreeId) {
    conditions.push(eq(chatConversations.worktreeId, input.worktreeId));
  }
  if (input.status) {
    conditions.push(eq(chatConversations.status, input.status));
  }

  const sessions = await ctx.db
    .select({
      id: chatConversations.id,
      title: chatConversations.title,
      repositoryId: chatConversations.repositoryId,
      worktreeId: chatConversations.worktreeId,
      workingDirectory: chatConversations.workingDirectory,
      agentType: chatConversations.agentType,
      status: chatConversations.status,
      nextSeq: chatConversations.nextSeq,
      lastActivityAt: chatConversations.lastActivityAt,
      lastError: chatConversations.lastError,
      createdAt: chatConversations.createdAt,
      updatedAt: chatConversations.updatedAt,
      workItemId: chatConversations.workItemId,
      workItemIdentifierSnapshot: chatConversations.workItemIdentifierSnapshot,
      planningTaskId: chatConversations.planningTaskId,
    })
    .from(chatConversations)
    .where(and(...conditions))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(input.limit + 1);

  const hasMore = sessions.length > input.limit;
  const items = hasMore ? sessions.slice(0, -1) : sessions;
  const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;
  const sessionIds = items.map((session) => session.id);
  const linkedTaskRows =
    sessionIds.length > 0
      ? await ctx.db
          .select({
            sessionId: taskRuns.sessionId,
            workItemId: taskRuns.workItemId,
            workItemIdentifierSnapshot: taskRuns.workItemIdentifierSnapshot,
            planningItemId: taskRuns.planningItemId,
            planningItemIdentifier: taskRuns.planningItemIdentifier,
          })
          .from(taskRuns)
          .where(inArray(taskRuns.sessionId, sessionIds))
          .orderBy(desc(taskRuns.createdAt))
      : [];
  const linkedTaskBySessionId = new Map<
    string,
    { id: string; identifier: string; url: string | null }
  >();

  for (const row of linkedTaskRows) {
    if (!row.sessionId || linkedTaskBySessionId.has(row.sessionId)) {
      continue;
    }

    const workItemId = row.workItemId ?? row.planningItemId;
    const workItemIdentifier =
      row.workItemIdentifierSnapshot ?? row.planningItemIdentifier;

    linkedTaskBySessionId.set(row.sessionId, {
      id: workItemId,
      identifier: workItemIdentifier,
      url: buildWorkItemUrl(workItemId),
    });
  }

  return {
    items: items.map((session) => ({
      ...session,
      workItemId: session.workItemId ?? session.planningTaskId,
      workItemIdentifier:
        session.workItemIdentifierSnapshot ??
        linkedTaskBySessionId.get(session.id)?.identifier ??
        null,
      linkedTask: linkedTaskBySessionId.get(session.id) ?? null,
      issueManaged: Boolean(session.workItemId ?? session.planningTaskId),
      planningTaskId: session.planningTaskId,
    })),
    nextCursor,
  };
}

export async function sessionGet(
  ctx: HandlerContext,
  input: { id: string },
) {
  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.id),
      eq(chatConversations.userId, ctx.userId),
    ),
    with: {
      repository: true,
      worktree: true,
      workItem: {
        columns: {
          id: true,
          projectId: true,
        },
      },
    },
  });

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  const latestTaskRun = await ctx.db.query.taskRuns.findFirst({
    where: and(
      eq(taskRuns.sessionId, session.id),
      eq(taskRuns.userId, ctx.userId),
    ),
    orderBy: desc(taskRuns.createdAt),
  });

  const resolvedWorkItemId =
    session.workItemId ??
    latestTaskRun?.workItemId ??
    session.planningTaskId;

  let projectId = session.workItem?.projectId ?? null;
  if (!projectId && latestTaskRun?.workItemId) {
    const workItem = await ctx.db.query.workItems.findFirst({
      where: eq(workItems.id, latestTaskRun.workItemId),
      columns: {
        id: true,
        projectId: true,
      },
    });
    projectId = workItem?.projectId ?? null;
  }

  return {
    ...session,
    workItemId: resolvedWorkItemId,
    workItemIdentifier:
      session.workItemIdentifierSnapshot ??
      latestTaskRun?.workItemIdentifierSnapshot ??
      latestTaskRun?.planningItemIdentifier ??
      null,
    projectId,
    linkedTask: latestTaskRun
      ? {
          id: latestTaskRun.workItemId ?? latestTaskRun.planningItemId,
          identifier:
            latestTaskRun.workItemIdentifierSnapshot ??
            latestTaskRun.planningItemIdentifier,
          url: buildWorkItemUrl(
            latestTaskRun.workItemId ?? latestTaskRun.planningItemId,
          ),
        }
      : null,
    issueManaged: Boolean(
      session.workItemId ??
        latestTaskRun?.workItemId ??
        session.planningTaskId,
    ),
    planningTaskId: session.planningTaskId,
  };
}

export async function sessionCreate(
  ctx: HandlerContext,
  input: {
    repositoryId?: string;
    worktreeId?: string;
    workingDirectory: string;
    agentType?: string;
    title?: string;
    personaId?: string;
  },
) {
  const resolved = await resolvePersonaDefaults(ctx, input);

  const [session] = await ctx.db
    .insert(chatConversations)
    .values({
      userId: ctx.userId,
      repositoryId: input.repositoryId ?? null,
      worktreeId: input.worktreeId ?? null,
      workingDirectory: input.workingDirectory,
      agentType: resolved.agentType,
      title: input.title ?? null,
      status: "provisioning",
      personaId: resolved.personaId,
      personaMetadata: resolved.personaMetadata,
    })
    .returning();

  return session;
}

export async function sessionBootstrapForChat(
  ctx: HandlerContext,
  input: {
    repositoryId?: string;
    worktreeId?: string;
    workingDirectory: string;
    agentType?: string;
    title?: string;
    personaId?: string;
  },
) {
  const resolved = await resolvePersonaDefaults(ctx, input);

  const [session] = await ctx.db
    .insert(chatConversations)
    .values({
      userId: ctx.userId,
      repositoryId: input.repositoryId ?? null,
      worktreeId: input.worktreeId ?? null,
      workingDirectory: input.workingDirectory,
      agentType: resolved.agentType,
      title: input.title ?? null,
      status: "provisioning",
      personaId: resolved.personaId,
      personaMetadata: resolved.personaMetadata,
    })
    .returning();

  if (!session) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create chat session",
    });
  }

  return {
    ...session,
    gateway: {
      url: getGatewaySocketUrl(),
      shouldStartOnConnect: true,
    },
  };
}

export async function sessionUpdateTitle(
  ctx: HandlerContext,
  input: { id: string; title: string },
) {
  const [updated] = await ctx.db
    .update(chatConversations)
    .set({ title: input.title })
    .where(
      and(
        eq(chatConversations.id, input.id),
        eq(chatConversations.userId, ctx.userId),
      ),
    )
    .returning();

  if (!updated) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  return updated;
}

export async function sessionStop(
  ctx: HandlerContext,
  input: { id: string },
) {
  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.id),
      eq(chatConversations.userId, ctx.userId),
    ),
  });

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  const [updated] = await ctx.db
    .update(chatConversations)
    .set({
      status: "stopped",
      claimedByGatewayId: null,
      leaseExpiresAt: null,
    })
    .where(eq(chatConversations.id, input.id))
    .returning();

  return updated;
}

export async function sessionDelete(
  ctx: HandlerContext,
  input: { id: string },
) {
  await ctx.db
    .delete(chatConversations)
    .where(
      and(
        eq(chatConversations.id, input.id),
        eq(chatConversations.userId, ctx.userId),
      ),
    );
  return { success: true };
}

export async function sessionGetEvents(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    fromSeq?: number;
    toSeq?: number;
    limit: number;
  },
) {
  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, ctx.userId),
    ),
  });

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  const conditions = [eq(sessionEvents.sessionId, input.sessionId)];
  if (input.fromSeq !== undefined) {
    conditions.push(gt(sessionEvents.seq, input.fromSeq));
  }
  if (input.toSeq !== undefined) {
    conditions.push(lt(sessionEvents.seq, input.toSeq));
  }

  const events = await ctx.db
    .select()
    .from(sessionEvents)
    .where(and(...conditions))
    .orderBy(asc(sessionEvents.seq))
    .limit(input.limit);

  return {
    events,
    latestSeq: session.nextSeq - 1,
  };
}

export async function sessionGetConnections(
  ctx: HandlerContext,
  input: { sessionId: string },
) {
  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, ctx.userId),
    ),
  });

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  const connections = await ctx.db
    .select()
    .from(sessionConnections)
    .where(eq(sessionConnections.sessionId, input.sessionId))
    .orderBy(desc(sessionConnections.connectedAt));

  return connections;
}

export async function sessionSendHeadlessInput(
  ctx: HandlerContext,
  input: { sessionId: string; message: string },
) {
  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, ctx.userId),
    ),
    columns: {
      status: true,
      agentType: true,
      opencodeSessionId: true,
      nextSeq: true,
    },
  });

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  if (session.agentType !== "opencode") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Headless mode currently supports opencode sessions only",
    });
  }

  const opencodeClient = createOpenCodeClient();
  let opencodeSessionId = session.opencodeSessionId;

  if (!opencodeSessionId?.trim()) {
    const created = await opencodeClient.createSession({
      bobConversationId: input.sessionId,
    });
    opencodeSessionId = created.id;

    await ctx.db
      .update(chatConversations)
      .set({
        opencodeSessionId,
      })
      .where(eq(chatConversations.id, input.sessionId));
  }

  const [updatedSession] = await ctx.db
    .update(chatConversations)
    .set({
      status: "running",
      lastActivityAt: new Date().toISOString(),
      nextSeq: sql`${chatConversations.nextSeq} + 2`,
    })
    .where(eq(chatConversations.id, input.sessionId))
    .returning({ nextSeq: chatConversations.nextSeq });

  const inputSeq = (updatedSession?.nextSeq ?? session.nextSeq) - 2;
  const outputSeq = inputSeq + 1;

  await ctx.db.insert(sessionEvents).values({
    sessionId: input.sessionId,
    seq: inputSeq,
    direction: "client",
    eventType: "input",
    payload: { data: input.message },
  });

  try {
    let content = "";
    const stream = await opencodeClient.sendMessage(
      opencodeSessionId,
      {
        role: "user",
        content: input.message,
      },
      { stream: true },
    );

    for await (const chunk of stream) {
      content += chunk.content;
    }

    await ctx.db.insert(sessionEvents).values({
      sessionId: input.sessionId,
      seq: outputSeq,
      direction: "agent",
      eventType: "message_final",
      payload: {
        content,
      },
    });

    return {
      sessionId: input.sessionId,
      seq: { input: inputSeq, assistant: outputSeq },
    };
  } catch (error) {
    const errorMessage = toErrorMessage(error);

    await ctx.db.insert(sessionEvents).values({
      sessionId: input.sessionId,
      seq: outputSeq,
      direction: "system",
      eventType: "error",
      payload: { message: errorMessage },
    });

    await ctx.db
      .update(chatConversations)
      .set({
        status: "error",
        lastError: {
          code: "HEADLESS_INPUT_ERROR",
          message: errorMessage,
          timestamp: new Date().toISOString(),
        },
        lastActivityAt: new Date().toISOString(),
      })
      .where(eq(chatConversations.id, input.sessionId));

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: errorMessage,
    });
  }
}

export async function sessionUpdateStatus(
  ctx: HandlerContext,
  input: {
    id: string;
    status: (typeof sessionStatusValues)[number];
    lastError?: { code: string; message: string; timestamp: string };
  },
) {
  const [updated] = await ctx.db
    .update(chatConversations)
    .set({
      status: input.status,
      lastError: input.lastError,
      lastActivityAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(chatConversations.id, input.id),
        eq(chatConversations.userId, ctx.userId),
      ),
    )
    .returning();

  if (!updated) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  return updated;
}

export async function sessionClaimLease(
  ctx: HandlerContext,
  input: { sessionId: string; gatewayId: string; leaseMs: number },
) {
  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, ctx.userId),
    ),
  });

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  const canClaim =
    !session.claimedByGatewayId ||
    session.claimedByGatewayId === input.gatewayId ||
    (session.leaseExpiresAt &&
      new Date(session.leaseExpiresAt) < new Date());

  if (!canClaim) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Session claimed by gateway ${session.claimedByGatewayId}`,
    });
  }

  const [updated] = await ctx.db
    .update(chatConversations)
    .set({
      claimedByGatewayId: input.gatewayId,
      leaseExpiresAt: new Date(Date.now() + input.leaseMs).toISOString(),
    })
    .where(eq(chatConversations.id, input.sessionId))
    .returning();

  return updated;
}

export async function sessionReleaseLease(
  ctx: HandlerContext,
  input: { sessionId: string },
) {
  const [updated] = await ctx.db
    .update(chatConversations)
    .set({
      claimedByGatewayId: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(chatConversations.id, input.sessionId),
        eq(chatConversations.userId, ctx.userId),
      ),
    )
    .returning();

  if (!updated) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  return updated;
}

export async function sessionRecordEvent(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    seq: number;
    direction: "client" | "agent" | "system";
    eventType: string;
    payload: Record<string, unknown>;
  },
) {
  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, ctx.userId),
    ),
  });

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  const [event] = await ctx.db
    .insert(sessionEvents)
    .values({
      sessionId: input.sessionId,
      seq: input.seq,
      direction: input.direction,
      eventType: input.eventType,
      payload: input.payload,
    })
    .returning();

  await ctx.db
    .update(chatConversations)
    .set({
      nextSeq: sql`GREATEST(${chatConversations.nextSeq}, ${input.seq + 1})`,
      lastActivityAt: new Date().toISOString(),
    })
    .where(eq(chatConversations.id, input.sessionId));

  return event;
}

export async function sessionRecordEventBatch(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    events: Array<{
      seq: number;
      direction: "client" | "agent" | "system";
      eventType: string;
      payload: Record<string, unknown>;
    }>;
  },
) {
  if (input.events.length === 0) return { count: 0 };

  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, ctx.userId),
    ),
  });

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  const eventsToInsert = input.events.map((e) => ({
    sessionId: input.sessionId,
    seq: e.seq,
    direction: e.direction,
    eventType: e.eventType,
    payload: e.payload,
  }));

  await ctx.db.insert(sessionEvents).values(eventsToInsert);

  const maxSeq = Math.max(...input.events.map((e) => e.seq));
  await ctx.db
    .update(chatConversations)
    .set({
      nextSeq: sql`GREATEST(${chatConversations.nextSeq}, ${maxSeq + 1})`,
      lastActivityAt: new Date().toISOString(),
    })
    .where(eq(chatConversations.id, input.sessionId));

  return { count: input.events.length };
}

export async function sessionGetGatewayWebSocketUrl(
  ctx: HandlerContext,
  _input: void,
) {
  return {
    url: getGatewaySocketUrl(),
    userId: ctx.userId,
  };
}

export async function sessionReportWorkflowStatus(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    status: WorkflowStatus;
    message: string;
    details?: { phase?: string; progress?: string };
  },
) {
  try {
    await reportWorkflowStatus(ctx.userId, {
      sessionId: input.sessionId,
      status: input.status,
      message: input.message,
      details: input.details,
    });
    return { success: true };
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error
          ? error.message
          : "Failed to update workflow status",
    });
  }
}

export async function sessionReportTaskProgress(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    message: string;
    phase?: string;
    progress?: string;
  },
) {
  try {
    await reportTaskProgress(ctx.userId, input);
    return { success: true };
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error
          ? error.message
          : "Failed to report task progress",
    });
  }
}

export async function sessionLinkTaskArtifact(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    artifactType:
      | "pr"
      | "verification"
      | "build"
      | "test_report"
      | "doc"
      | "deliverable"
      | "other";
    artifactRole?:
      | "primary"
      | "review"
      | "verification"
      | "documentation"
      | "deliverable"
      | "build"
      | "test_report"
      | "other";
    url: string;
    title?: string;
    summary?: string;
  },
) {
  try {
    await linkTaskArtifact(ctx.userId, input);
    return { success: true };
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error
          ? error.message
          : "Failed to attach task artifact",
    });
  }
}

export async function sessionMarkTaskReviewReady(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    prUrl: string;
    summary: string;
    notesForReviewer?: string;
  },
) {
  try {
    await markTaskReviewReady(ctx.userId, input);
    return { success: true };
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error
          ? error.message
          : "Failed to mark task review ready",
    });
  }
}

export async function sessionRecordVerificationResult(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    result: "passed" | "failed";
    summary: string;
    artifactUrl?: string;
  },
) {
  try {
    await recordVerificationResult(ctx.userId, input);
    return { success: true };
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error
          ? error.message
          : "Failed to record verification result",
    });
  }
}

export async function sessionCompleteTask(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    summary: string;
    prUrl?: string;
    markIssueDone?: boolean;
  },
) {
  try {
    await completeTask(ctx.userId, input);
    return { success: true };
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error ? error.message : "Failed to complete task",
    });
  }
}

export async function sessionRequestInput(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    question: string;
    options?: string[];
    defaultAction: string;
    timeoutMinutes?: number;
  },
) {
  try {
    const result = await requestInput(ctx.userId, {
      sessionId: input.sessionId,
      question: input.question,
      options: input.options,
      defaultAction: input.defaultAction,
      timeoutMinutes: input.timeoutMinutes,
    });
    return result;
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error ? error.message : "Failed to request input",
    });
  }
}

export async function sessionResolveAwaitingInput(
  ctx: HandlerContext,
  input: {
    sessionId: string;
    resolution: { type: "human" | "timeout"; value: string };
  },
) {
  try {
    await resolveAwaitingInput(ctx.userId, {
      sessionId: input.sessionId,
      resolution: input.resolution,
    });
    return { success: true };
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error
          ? error.message
          : "Failed to resolve awaiting input",
    });
  }
}

export async function sessionGetWorkflowState(
  ctx: HandlerContext,
  input: { sessionId: string },
) {
  const state = await getSessionWorkflowState(ctx.userId, input.sessionId);
  if (!state) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }
  return state;
}

export async function sessionCreateVoiceSession(
  ctx: HandlerContext,
  input: { sessionId: string },
) {
  const service = getElevenLabsService();
  if (!service) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ElevenLabs service not configured",
    });
  }

  // Verify session belongs to user
  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, ctx.userId),
    ),
  });

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  if (session.agentType !== "elevenlabs") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Session agent type must be 'elevenlabs'",
    });
  }

  const voiceSession = await service.createVoiceSession(input.sessionId);

  // Register transcript callback to persist events
  service.onTranscript(input.sessionId, async (event) => {
    const nextSeq = session.nextSeq;
    await ctx.db.insert(sessionEvents).values({
      sessionId: input.sessionId,
      seq: nextSeq,
      direction: event.type === "user" ? "client" : "agent",
      eventType: "transcript",
      payload: {
        type: event.type,
        text: event.text,
        timestamp: event.timestamp.toISOString(),
      },
    });

    await ctx.db
      .update(chatConversations)
      .set({
        nextSeq: sql`GREATEST(${chatConversations.nextSeq}, ${nextSeq + 1})`,
        lastActivityAt: new Date().toISOString(),
      })
      .where(eq(chatConversations.id, input.sessionId));
  });

  return voiceSession;
}

export async function sessionStopVoiceSession(
  ctx: HandlerContext,
  input: { sessionId: string },
) {
  const service = getElevenLabsService();
  if (!service) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ElevenLabs service not configured",
    });
  }

  // Verify session belongs to user
  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, ctx.userId),
    ),
  });

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  await service.stopVoiceSession(input.sessionId);
  return { success: true };
}

export async function sessionHandleVoiceTranscript(
  ctx: HandlerContext,
  input: { sessionId: string; transcript: string },
) {
  const service = getElevenLabsService();
  if (!service) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ElevenLabs service not configured",
    });
  }

  // Verify session belongs to user
  const session = await ctx.db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, ctx.userId),
    ),
  });

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found",
    });
  }

  const assistantText = await service.handleUserTranscript(
    input.sessionId,
    input.transcript,
  );

  return { assistantText };
}
