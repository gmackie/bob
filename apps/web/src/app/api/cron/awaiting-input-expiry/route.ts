import { NextResponse } from "next/server";

import { findExpiredAwaitingInputSessions } from "@bob/api/services/sessions/workflowStatusService";
import { eq, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, sessionEvents } from "@bob/db/schema";

const CRON_SECRET = process.env.CRON_SECRET;
const KANBANGER_API_URL =
  process.env.KANBANGER_API_URL ?? "https://tasks.gmac.io/api";
const KANBANGER_API_KEY = process.env.KANBANGER_API_KEY;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expiredSessions = await findExpiredAwaitingInputSessions();

  const results: Array<{
    sessionId: string;
    status: "resolved" | "error";
    defaultAction: string;
    error?: string;
  }> = [];

  for (const session of expiredSessions) {
    try {
      await resolveWithTimeout(session);
      results.push({
        sessionId: session.id,
        status: "resolved",
        defaultAction: session.awaitingInputDefault,
      });
    } catch (error) {
      results.push({
        sessionId: session.id,
        status: "error",
        defaultAction: session.awaitingInputDefault,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const resolved = results.filter((r) => r.status === "resolved").length;
  const errors = results.filter((r) => r.status === "error").length;

  return NextResponse.json({
    processed: results.length,
    resolved,
    errors,
    results,
  });
}

async function resolveWithTimeout(session: {
  id: string;
  userId: string;
  awaitingInputDefault: string;
  kanbangerTaskId: string | null;
}): Promise<void> {
  const resolutionJson = JSON.stringify({
    type: "timeout",
    value: session.awaitingInputDefault,
  });

  await db.execute(sql`
    UPDATE chat_conversations
    SET workflow_status = 'working',
        status_message = ${"Timeout: " + session.awaitingInputDefault},
        awaiting_input_resolved_at = NOW(),
        awaiting_input_resolution = ${resolutionJson}::jsonb
    WHERE id = ${session.id}
  `);

  const sessionData = await db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, session.id),
    columns: { nextSeq: true },
  });

  const nextSeq = sessionData?.nextSeq ?? 0;

  await db
    .update(chatConversations)
    .set({ nextSeq: nextSeq + 1 })
    .where(eq(chatConversations.id, session.id));

  await db.insert(sessionEvents).values({
    sessionId: session.id,
    seq: nextSeq,
    direction: "system",
    eventType: "state",
    payload: {
      type: "workflow_status",
      workflowStatus: "working",
      message: `Timeout: proceeding with "${session.awaitingInputDefault}"`,
      resolution: {
        type: "timeout",
        value: session.awaitingInputDefault,
      },
    },
  });

  if (session.kanbangerTaskId) {
    await postKanbangerComment(
      session.kanbangerTaskId,
      `Timeout reached. Proceeding with: **${session.awaitingInputDefault}**`,
    );
  }
}

async function postKanbangerComment(
  taskId: string,
  body: string,
): Promise<void> {
  if (!KANBANGER_API_KEY) {
    console.warn("KANBANGER_API_KEY not set, skipping timeout comment");
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
      console.error(
        "Failed to post Kanbanger timeout comment:",
        await response.text(),
      );
    }
  } catch (error) {
    console.error("Error posting Kanbanger timeout comment:", error);
  }
}
