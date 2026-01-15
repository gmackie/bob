import { and, eq, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, sessionEvents } from "@bob/db/schema";

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

function isValidTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
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
  const session = await db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, userId),
    ),
  });

  if (!session) {
    throw new Error("Session not found");
  }

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

  await db.execute(sql`
    UPDATE chat_conversations
    SET workflow_status = ${input.status},
        status_message = ${input.message}
    WHERE id = ${input.sessionId}
  `);

  const nextSeq = session.nextSeq;
  await db
    .update(chatConversations)
    .set({ nextSeq: nextSeq + 1 })
    .where(eq(chatConversations.id, input.sessionId));

  await db.insert(sessionEvents).values({
    sessionId: input.sessionId,
    seq: nextSeq,
    direction: "system",
    eventType: "state",
    payload: {
      type: "workflow_status",
      workflowStatus: input.status,
      message: input.message,
      details: input.details,
    },
  });

  const kanbangerTaskId = (session as Record<string, unknown>)
    .kanbangerTaskId as string | null;
  if (kanbangerTaskId) {
    await postKanbangerStatusUpdate(
      kanbangerTaskId,
      input.status,
      input.message,
    );
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
  const session = await db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, userId),
    ),
  });

  if (!session) {
    throw new Error("Session not found");
  }

  const currentStatus = (session as Record<string, unknown>)
    .workflowStatus as WorkflowStatus;
  if (!isValidTransition(currentStatus, "awaiting_input")) {
    throw new Error(`Cannot request input from status: ${currentStatus}`);
  }

  const timeoutMinutes = input.timeoutMinutes ?? 30;
  const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);
  const optionsJson = input.options ? JSON.stringify(input.options) : null;

  await db.execute(sql`
    UPDATE chat_conversations
    SET workflow_status = 'awaiting_input',
        status_message = ${input.question},
        awaiting_input_question = ${input.question},
        awaiting_input_options = ${optionsJson}::jsonb,
        awaiting_input_default = ${input.defaultAction},
        awaiting_input_expires_at = ${expiresAt.toISOString()}::timestamptz,
        awaiting_input_resolved_at = NULL,
        awaiting_input_resolution = NULL
    WHERE id = ${input.sessionId}
  `);

  const nextSeq = session.nextSeq;
  await db
    .update(chatConversations)
    .set({ nextSeq: nextSeq + 1 })
    .where(eq(chatConversations.id, input.sessionId));

  await db.insert(sessionEvents).values({
    sessionId: input.sessionId,
    seq: nextSeq,
    direction: "system",
    eventType: "state",
    payload: {
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

  const kanbangerTaskId = (session as Record<string, unknown>)
    .kanbangerTaskId as string | null;
  if (kanbangerTaskId) {
    const optionsText = input.options?.length
      ? `\n\nOptions:\n${input.options.map((o) => `- ${o}`).join("\n")}`
      : "";
    const comment = `💭 **Question:** ${input.question}${optionsText}\n\nI'll proceed with **${input.defaultAction}** in ${timeoutMinutes} minutes unless you respond.`;
    await postKanbangerComment(kanbangerTaskId, comment);
  }

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
  const session = await db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, input.sessionId),
      eq(chatConversations.userId, userId),
    ),
  });

  if (!session) {
    throw new Error("Session not found");
  }

  const currentStatus = (session as Record<string, unknown>)
    .workflowStatus as WorkflowStatus;
  if (currentStatus !== "awaiting_input") {
    throw new Error(
      `Session is not awaiting input (current: ${currentStatus})`,
    );
  }

  const resolutionJson = JSON.stringify(input.resolution);

  await db.execute(sql`
    UPDATE chat_conversations
    SET workflow_status = 'working',
        status_message = ${"Resolved: " + input.resolution.value},
        awaiting_input_resolved_at = NOW(),
        awaiting_input_resolution = ${resolutionJson}::jsonb
    WHERE id = ${input.sessionId}
  `);

  const nextSeq = session.nextSeq;
  await db
    .update(chatConversations)
    .set({ nextSeq: nextSeq + 1 })
    .where(eq(chatConversations.id, input.sessionId));

  await db.insert(sessionEvents).values({
    sessionId: input.sessionId,
    seq: nextSeq,
    direction: "system",
    eventType: "state",
    payload: {
      type: "workflow_status",
      workflowStatus: "working",
      message: `Resolved: ${input.resolution.value}`,
      resolution: input.resolution,
    },
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
  const session = await db.query.chatConversations.findFirst({
    where: and(
      eq(chatConversations.id, sessionId),
      eq(chatConversations.userId, userId),
    ),
  });

  if (!session) {
    throw new Error("Session not found");
  }

  await reportWorkflowStatus(userId, {
    sessionId,
    status: "awaiting_review",
    message: message ?? "PR submitted for review",
  });

  await db.execute(sql`
    UPDATE chat_conversations
    SET pull_request_id = ${prId}::uuid
    WHERE id = ${sessionId}
  `);
}

export async function findExpiredAwaitingInputSessions(): Promise<
  Array<{
    id: string;
    userId: string;
    awaitingInputDefault: string;
    kanbangerTaskId: string | null;
  }>
> {
  const result = await db.execute(sql`
    SELECT id, user_id, awaiting_input_default, kanbanger_task_id
    FROM chat_conversations
    WHERE workflow_status = 'awaiting_input'
      AND awaiting_input_expires_at <= NOW()
      AND awaiting_input_resolved_at IS NULL
  `);

  return (
    result.rows as Array<{
      id: string;
      user_id: string;
      awaiting_input_default: string;
      kanbanger_task_id: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    userId: row.user_id,
    awaitingInputDefault: row.awaiting_input_default ?? "proceed with default",
    kanbangerTaskId: row.kanbanger_task_id,
  }));
}

const KANBANGER_API_URL =
  process.env.KANBANGER_API_URL ?? "https://tasks.gmac.io/api";
const KANBANGER_API_KEY = process.env.KANBANGER_API_KEY;

async function postKanbangerComment(
  taskId: string,
  body: string,
): Promise<void> {
  if (!KANBANGER_API_KEY) {
    console.warn("KANBANGER_API_KEY not set, skipping comment");
    return;
  }

  try {
    const response = await fetch(
      `${KANBANGER_API_URL}/issues/${taskId}/comments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KANBANGER_API_KEY}`,
        },
        body: JSON.stringify({ body }),
      },
    );

    if (!response.ok) {
      console.error("Failed to post Kanbanger comment:", await response.text());
    }
  } catch (error) {
    console.error("Error posting Kanbanger comment:", error);
  }
}

async function postKanbangerStatusUpdate(
  taskId: string,
  status: WorkflowStatus,
  message: string,
): Promise<void> {
  const statusEmojis: Record<WorkflowStatus, string> = {
    started: "🤖",
    working: "⚙️",
    awaiting_input: "💭",
    blocked: "🚫",
    awaiting_review: "👀",
    completed: "✅",
  };

  const shouldPost = ["blocked", "awaiting_review", "completed"].includes(
    status,
  );
  if (!shouldPost) return;

  const emoji = statusEmojis[status] ?? "📝";
  const body = `${emoji} **${status.replace("_", " ").toUpperCase()}**: ${message}`;
  await postKanbangerComment(taskId, body);
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
    expiresAt: Date;
  } | null;
} | null> {
  const result = await db.execute(sql`
    SELECT workflow_status, status_message,
           awaiting_input_question, awaiting_input_options,
           awaiting_input_default, awaiting_input_expires_at
    FROM chat_conversations
    WHERE id = ${sessionId} AND user_id = ${userId}
  `);

  if (result.rows.length === 0) return null;

  const row = result.rows[0] as {
    workflow_status: WorkflowStatus;
    status_message: string | null;
    awaiting_input_question: string | null;
    awaiting_input_options: string[] | null;
    awaiting_input_default: string | null;
    awaiting_input_expires_at: Date | null;
  };

  const awaitingInput =
    row.workflow_status === "awaiting_input" && row.awaiting_input_question
      ? {
          question: row.awaiting_input_question,
          options: row.awaiting_input_options,
          defaultAction: row.awaiting_input_default ?? "",
          expiresAt: row.awaiting_input_expires_at ?? new Date(),
        }
      : null;

  return {
    workflowStatus: row.workflow_status,
    statusMessage: row.status_message,
    awaitingInput,
  };
}
