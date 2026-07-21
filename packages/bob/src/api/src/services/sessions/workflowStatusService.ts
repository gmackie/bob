import { and, eq, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, sessionEvents } from "@bob/db/schema";
import {
  attachArtifact,
  completeTaskRun,
  markRunReviewReady as writeReviewReady,
  recordPromptResolution,
  recordVerificationResult as writeVerificationResult,
  reportMilestone,
  requestInputPrompt,
} from "../integrations/planningWriteService";

export const workflowStatusValues = [
  "started",
  "working",
  "awaiting_input",
  "blocked",
  "awaiting_review",
  "completed",
] as const;

export type WorkflowStatus = (typeof workflowStatusValues)[number];

const VALID_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  started: ["working"],
  working: ["awaiting_input", "blocked", "awaiting_review", "completed"],
  awaiting_input: ["working"],
  blocked: ["working"],
  awaiting_review: ["working", "completed"],
  completed: [],
};

function readExecuteRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }

  return [];
}

function isValidTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

async function getOwnedSession(userId: string, sessionId: string) {
  const session = await db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, sessionId),
      eq(chatConversations.userId, userId),
    ),
  });

  if (!session) {
    throw new Error("Session not found");
  }

  return session;
}

async function updateWorkflowState(
  session: Awaited<ReturnType<typeof getOwnedSession>>,
  input: {
    workflowStatus: WorkflowStatus;
    message: string;
    updates?: Record<string, unknown>;
    eventPayload: Record<string, unknown>;
  },
) {
  await db
    .update(chatConversations)
    .set({
      workflowStatus: input.workflowStatus,
      statusMessage: input.message,
      ...(input.updates ?? {}),
    })
    .where(eq(chatConversations.id, session.id));

  const nextSeq = session.nextSeq;
  await db
    .update(chatConversations)
    .set({ nextSeq: nextSeq + 1 })
    .where(eq(chatConversations.id, session.id));

  await db.insert(sessionEvents).values({
    sessionId: session.id,
    seq: nextSeq,
    direction: "system",
    eventType: "state",
    payload: input.eventPayload,
  });
}

export interface ReportWorkflowStatusInput {
  sessionId: string;
  status: WorkflowStatus;
  message: string;
  details?: { phase?: string; progress?: string };
}

export async function reportWorkflowStatus(
  userId: string,
  input: ReportWorkflowStatusInput,
): Promise<void> {
  const session = await getOwnedSession(userId, input.sessionId);

  const currentStatus = (session as Record<string, unknown>)
    .workflowStatus as WorkflowStatus;

  if (
    currentStatus !== input.status &&
    !isValidTransition(currentStatus, input.status)
  ) {
    throw new Error(
      `Invalid workflow transition: ${currentStatus} → ${input.status}`,
    );
  }

  await updateWorkflowState(session, {
    workflowStatus: input.status,
    message: input.message,
    eventPayload: {
      type: "workflow_status",
      workflowStatus: input.status,
      message: input.message,
      details: input.details,
    },
  });

  switch (input.status) {
    case "working":
      await reportMilestone({
        userId,
        sessionId: input.sessionId,
        kind: "progress",
        message: input.message,
        phase: input.details?.phase,
        progress: input.details?.progress,
      });
      break;
    case "blocked":
      await reportMilestone({
        userId,
        sessionId: input.sessionId,
        kind: "blocked",
        message: input.message,
      });
      break;
    case "awaiting_review":
      await reportMilestone({
        userId,
        sessionId: input.sessionId,
        kind: "review_ready",
        message: input.message,
      });
      break;
    case "completed":
      await completeTaskRun({
        userId,
        sessionId: input.sessionId,
        summary: input.message,
      });
      break;
    default:
      break;
  }
}

export interface RequestInputInput {
  sessionId: string;
  question: string;
  options?: string[];
  defaultAction: string;
  timeoutMinutes?: number;
}

export async function requestInput(
  userId: string,
  input: RequestInputInput,
): Promise<{ expiresAt: Date }> {
  const session = await getOwnedSession(userId, input.sessionId);

  const currentStatus = (session as Record<string, unknown>)
    .workflowStatus as WorkflowStatus;
  if (!isValidTransition(currentStatus, "awaiting_input")) {
    throw new Error(`Cannot request input from status: ${currentStatus}`);
  }

  const timeoutMinutes = input.timeoutMinutes ?? 30;
  const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);
  await updateWorkflowState(session, {
    workflowStatus: "awaiting_input",
    message: input.question,
    updates: {
      awaitingInputQuestion: input.question,
      awaitingInputOptions: input.options ?? null,
      awaitingInputDefault: input.defaultAction,
      awaitingInputExpiresAt: expiresAt,
      awaitingInputResolvedAt: null,
      awaitingInputResolution: null,
    },
    eventPayload: {
      type: "workflow_status",
      workflowStatus: "awaiting_input",
      message: input.question,
      awaitingInput: {
        question: input.question,
        options: input.options,
        defaultAction: input.defaultAction,
        expiresAt: expiresAt.toISOString(),
      },
    },
  });

  await requestInputPrompt({
    userId,
    sessionId: input.sessionId,
    question: input.question,
    options: input.options,
    defaultAction: input.defaultAction,
    timeoutMinutes,
    expiresAt,
  });

  return { expiresAt };
}

export interface ResolveAwaitingInputInput {
  sessionId: string;
  resolution: { type: "human" | "timeout"; value: string };
}

export async function resolveAwaitingInput(
  userId: string,
  input: ResolveAwaitingInputInput,
): Promise<void> {
  const session = await getOwnedSession(userId, input.sessionId);

  const currentStatus = (session as Record<string, unknown>)
    .workflowStatus as WorkflowStatus;
  if (currentStatus !== "awaiting_input") {
    throw new Error(
      `Session is not awaiting input (current: ${currentStatus})`,
    );
  }

  await updateWorkflowState(session, {
    workflowStatus: "working",
    message: `Resolved: ${input.resolution.value}`,
    updates: {
      awaitingInputResolvedAt: new Date(),
      awaitingInputResolution: input.resolution,
    },
    eventPayload: {
      type: "workflow_status",
      workflowStatus: "working",
      message: `Resolved: ${input.resolution.value}`,
      resolution: input.resolution,
    },
  });

  await recordPromptResolution({
    userId,
    sessionId: input.sessionId,
    resolutionType: input.resolution.type,
    value: input.resolution.value,
  });
}

export async function markBlocked(
  userId: string,
  sessionId: string,
  reason: string,
): Promise<void> {
  await reportWorkflowStatus(userId, {
    sessionId,
    status: "blocked",
    message: reason,
  });
}

export async function submitForReview(
  userId: string,
  sessionId: string,
  prId: string,
  message?: string,
): Promise<void> {
  await markTaskReviewReady(userId, {
    sessionId,
    prUrl: prId,
    summary: message ?? "PR submitted for review",
  });
}

export interface ReportTaskProgressInput {
  sessionId: string;
  message: string;
  phase?: string;
  progress?: string;
}

export async function reportTaskProgress(
  userId: string,
  input: ReportTaskProgressInput,
): Promise<void> {
  await reportWorkflowStatus(userId, {
    sessionId: input.sessionId,
    status: "working",
    message: input.message,
    details: {
      phase: input.phase,
      progress: input.progress,
    },
  });
}

export interface LinkTaskArtifactInput {
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
}

export async function linkTaskArtifact(
  userId: string,
  input: LinkTaskArtifactInput,
): Promise<void> {
  await getOwnedSession(userId, input.sessionId);

  await attachArtifact({
    userId,
    sessionId: input.sessionId,
    artifactType: input.artifactType,
    artifactRole: input.artifactRole,
    url: input.url,
    title: input.title,
    summary: input.summary,
  });
}

export interface MarkTaskReviewReadyInput {
  sessionId: string;
  summary: string;
  prUrl: string;
  notesForReviewer?: string;
}

export async function markTaskReviewReady(
  userId: string,
  input: MarkTaskReviewReadyInput,
): Promise<void> {
  const session = await getOwnedSession(userId, input.sessionId);
  const currentStatus = (session as Record<string, unknown>)
    .workflowStatus as WorkflowStatus;

  if (
    currentStatus !== "awaiting_review" &&
    !isValidTransition(currentStatus, "awaiting_review")
  ) {
    throw new Error(
      `Invalid workflow transition: ${currentStatus} → awaiting_review`,
    );
  }

  await updateWorkflowState(session, {
    workflowStatus: "awaiting_review",
    message: input.summary,
    eventPayload: {
      type: "workflow_status",
      workflowStatus: "awaiting_review",
      message: input.summary,
      details: {
        prUrl: input.prUrl,
        notesForReviewer: input.notesForReviewer,
      },
    },
  });

  await writeReviewReady({
    userId,
    sessionId: input.sessionId,
    summary: input.summary,
    prUrl: input.prUrl,
    notesForReviewer: input.notesForReviewer,
  });
}

export interface RecordVerificationResultInput {
  sessionId: string;
  result: "passed" | "failed";
  summary: string;
  artifactUrl?: string;
}

export async function recordVerificationResult(
  userId: string,
  input: RecordVerificationResultInput,
): Promise<void> {
  await getOwnedSession(userId, input.sessionId);

  await writeVerificationResult({
    userId,
    sessionId: input.sessionId,
    result: input.result,
    summary: input.summary,
    artifactUrl: input.artifactUrl,
  });
}

export interface CompleteTaskInput {
  sessionId: string;
  summary: string;
  prUrl?: string;
  markIssueDone?: boolean;
}

export async function completeTask(
  userId: string,
  input: CompleteTaskInput,
): Promise<void> {
  const session = await getOwnedSession(userId, input.sessionId);
  const currentStatus = (session as Record<string, unknown>)
    .workflowStatus as WorkflowStatus;

  if (
    currentStatus !== "completed" &&
    !isValidTransition(currentStatus, "completed")
  ) {
    throw new Error(`Invalid workflow transition: ${currentStatus} → completed`);
  }

  await updateWorkflowState(session, {
    workflowStatus: "completed",
    message: input.summary,
    eventPayload: {
      type: "workflow_status",
      workflowStatus: "completed",
      message: input.summary,
      details: {
        prUrl: input.prUrl,
        markIssueDone: false,
      },
    },
  });

  await completeTaskRun({
    userId,
    sessionId: input.sessionId,
    summary: input.summary,
    prUrl: input.prUrl,
    markIssueDone: false,
  });
}

/**
 * UNUSED — and it is NOT the safety net it looks like. Nothing in production
 * calls this: no cron, no gateway sweep, no handler. `requestInput` writes
 * `awaitingInputExpiresAt`, but no code ever acts on an elapsed one, so a
 * session that reached `awaiting_input` would wait forever with its
 * `awaitingInputDefault` never applied.
 *
 * In practice nothing reaches that state at all — every conversation in
 * production sits at workflowStatus "started"; the value has never been
 * anything else, and no client calls `session.requestInput`.
 *
 * The LIVE human-wait is a different axis entirely: `chatConversations.status`
 * = "blocked" (the permission-mode tool gate), expired by the gateway's
 * sweepAbandonedApprovals. Do not read this function, the
 * `[workflowStatus, awaitingInputExpiresAt]` index, or its tests as covering
 * that path — they never have. Wire this up or delete it; leaving it looking
 * load-bearing is how the blocked path went two days without a TTL.
 */
export async function findExpiredAwaitingInputSessions(): Promise<
  {
    id: string;
    userId: string;
    awaitingInputDefault: string;
    planningTaskId: string | null;
  }[]
> {
  const result = await db.execute(sql`
    SELECT id, user_id, awaiting_input_default,
           kanbanger_task_id AS planning_task_id
    FROM chat_conversations
    WHERE workflow_status = 'awaiting_input'
      AND awaiting_input_expires_at <= NOW()
      AND awaiting_input_resolved_at IS NULL
  `);

  return readExecuteRows<{
    id: string;
    user_id: string;
    awaiting_input_default: string | null;
    planning_task_id: string | null;
  }>(result).map((row) => ({
    id: row.id,
    userId: row.user_id,
    awaitingInputDefault: row.awaiting_input_default ?? "proceed with default",
    planningTaskId: row.planning_task_id,
  }));
}

export async function getSessionWorkflowState(
  userId: string,
  sessionId: string,
): Promise<{
  workflowStatus: WorkflowStatus;
  statusMessage: string | null;
  awaitingInput: {
    question: string;
    options: string[] | null;
    defaultAction: string;
    expiresAt: Date | string;
  } | null;
} | null> {
  const row = await db.query.chatConversations.findFirst({
    columns: {
      workflowStatus: true,
      statusMessage: true,
      awaitingInputQuestion: true,
      awaitingInputOptions: true,
      awaitingInputDefault: true,
      awaitingInputExpiresAt: true,
    },
    where: and(
      eq(chatConversations.id, sessionId),
      eq(chatConversations.userId, userId),
    ),
  });

  if (!row) return null;

  const awaitingInput =
    row.workflowStatus === "awaiting_input" && row.awaitingInputQuestion
      ? {
          question: row.awaitingInputQuestion,
          options: row.awaitingInputOptions,
          defaultAction: row.awaitingInputDefault ?? "",
          expiresAt: row.awaitingInputExpiresAt ?? new Date(),
        }
      : null;

  return {
    workflowStatus: row.workflowStatus as WorkflowStatus,
    statusMessage: row.statusMessage,
    awaitingInput,
  };
}
