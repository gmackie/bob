import { NextResponse } from "next/server";

import {
  markDeliveryFailed,
  markDeliveryProcessed,
  recordWebhookDelivery,
} from "@bob/api/services/webhooks/processWebhook";
import { eq, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, sessionEvents, user } from "@bob/db/schema";

import type { KanbangerTask } from "~/lib/tasks/taskExecutor";
import {
  executeTask,
  getTaskRunByKanbangerId,
  resumeBlockedTask,
} from "~/lib/tasks/taskExecutor";

const KANBANGER_WEBHOOK_SECRET = process.env.KANBANGER_WEBHOOK_SECRET;

export async function POST(request: Request): Promise<NextResponse> {
  const eventType = request.headers.get("X-Kanbanger-Event");
  const signature = request.headers.get("X-Kanbanger-Signature");

  if (!eventType) {
    return NextResponse.json(
      { error: "Missing X-Kanbanger-Event header" },
      { status: 400 },
    );
  }

  const body = await request.text();

  let signatureValid = true;
  if (KANBANGER_WEBHOOK_SECRET && signature) {
    const { createHmac, timingSafeEqual } = await import("node:crypto");
    const expectedSignature = createHmac("sha256", KANBANGER_WEBHOOK_SECRET)
      .update(body, "utf8")
      .digest("hex");

    try {
      signatureValid = timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expectedSignature, "hex"),
      );
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const action = typeof payload.action === "string" ? payload.action : null;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key.startsWith("x-kanbanger") || key === "content-type") {
      headers[key] = value;
    }
  });

  const recordId = await recordWebhookDelivery({
    provider: "kanbanger",
    deliveryId: null,
    eventType,
    action,
    signatureValid,
    headers,
    payload,
  });

  if (!recordId) {
    return NextResponse.json({ status: "duplicate" });
  }

  try {
    await processKanbangerWebhook(eventType, action, payload, recordId);
    return NextResponse.json({ status: "processed", deliveryId: recordId });
  } catch (error) {
    console.error("Kanbanger webhook processing error:", error);
    return NextResponse.json(
      { status: "error", deliveryId: recordId },
      { status: 500 },
    );
  }
}

async function processKanbangerWebhook(
  eventType: string,
  action: string | null,
  payload: Record<string, unknown>,
  deliveryId: string,
): Promise<void> {
  try {
    switch (eventType) {
      case "task":
        if (action === "assigned") {
          await handleTaskAssigned(payload);
        }
        break;
      case "comment":
        if (action === "created") {
          await handleCommentCreated(payload);
        }
        break;
      default:
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
}

interface KanbangerTaskPayload {
  issue: {
    id: string;
    identifier: string;
    title: string;
    description?: string;
  };
  workspace: {
    id: string;
  };
  project: {
    id: string;
  };
  assignee?: {
    id: string;
    email: string;
  };
  labels?: Array<{ name: string }>;
  priority?: number;
}

async function handleTaskAssigned(
  payload: Record<string, unknown>,
): Promise<void> {
  const data = payload as unknown as KanbangerTaskPayload;

  if (!data.issue || !data.workspace || !data.assignee?.email) {
    console.log("Task assigned webhook missing required fields");
    return;
  }

  const assigneeUser = await db.query.user.findFirst({
    where: eq(user.email, data.assignee.email),
  });

  if (!assigneeUser) {
    console.log(`No user found for email ${data.assignee.email}`);
    return;
  }

  const task: KanbangerTask = {
    id: data.issue.id,
    identifier: data.issue.identifier,
    title: data.issue.title,
    description: data.issue.description ?? null,
    workspaceId: data.workspace.id,
    projectId: data.project?.id ?? "",
    assigneeId: data.assignee.id,
    labels: data.labels?.map((l) => l.name) ?? [],
    priority: data.priority ?? 0,
  };

  const result = await executeTask(assigneeUser.id, task);

  console.log(
    `Task ${task.identifier} execution started: taskRunId=${result.taskRunId}, status=${result.status}`,
  );

  if (result.status === "blocked" || result.status === "failed") {
    console.log(
      `Task ${task.identifier} blocked/failed: ${result.blockedReason}`,
    );
  }
}

interface KanbangerCommentPayload {
  issue: {
    id: string;
    identifier: string;
  };
  comment: {
    id: string;
    body: string;
    user: {
      id: string;
      email: string;
    };
  };
}

async function handleCommentCreated(
  payload: Record<string, unknown>,
): Promise<void> {
  const data = payload as unknown as KanbangerCommentPayload;

  if (!data.issue || !data.comment) {
    console.log("Comment created webhook missing required fields");
    return;
  }

  const resolvedAwaitingInput = await resolveAwaitingInputFromComment(data);

  if (!resolvedAwaitingInput) {
    const blockedTaskRun = await getTaskRunByKanbangerId(data.issue.id);

    if (!blockedTaskRun) {
      console.log(
        `No blocked task run found for issue ${data.issue.identifier}`,
      );
      return;
    }

    const contextMessage = `**Comment from ${data.comment.user.email}:**\n\n${data.comment.body}`;

    await resumeBlockedTask(blockedTaskRun.id, contextMessage);

    console.log(
      `Resumed blocked task ${data.issue.identifier} with comment from ${data.comment.user.email}`,
    );
  }
}

async function resolveAwaitingInputFromComment(
  data: KanbangerCommentPayload,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT id, user_id, next_seq
    FROM chat_conversations
    WHERE kanbanger_task_id = ${data.issue.id}
      AND workflow_status = 'awaiting_input'
      AND awaiting_input_resolved_at IS NULL
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    return false;
  }

  const session = result.rows[0] as {
    id: string;
    user_id: string;
    next_seq: number;
  };

  const responseValue = data.comment.body.trim();
  const resolutionJson = JSON.stringify({
    type: "human",
    value: responseValue,
    commentId: data.comment.id,
    userId: data.comment.user.id,
    userEmail: data.comment.user.email,
  });

  await db.execute(sql`
    UPDATE chat_conversations
    SET workflow_status = 'working',
        status_message = ${"Human response: " + responseValue.slice(0, 100)},
        awaiting_input_resolved_at = NOW(),
        awaiting_input_resolution = ${resolutionJson}::jsonb
    WHERE id = ${session.id}
  `);

  await db
    .update(chatConversations)
    .set({ nextSeq: session.next_seq + 1 })
    .where(eq(chatConversations.id, session.id));

  await db.insert(sessionEvents).values({
    sessionId: session.id,
    seq: session.next_seq,
    direction: "system",
    eventType: "state",
    payload: {
      type: "workflow_status",
      workflowStatus: "working",
      message: `Human response: ${responseValue.slice(0, 100)}`,
      resolution: {
        type: "human",
        value: responseValue,
        source: "kanbanger_comment",
        commentId: data.comment.id,
      },
    },
  });

  console.log(
    `Resolved awaiting_input for session ${session.id} with comment from ${data.comment.user.email}`,
  );

  return true;
}
