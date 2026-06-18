import { eq } from "@bob/db";
import {
  chatConversations,
  dispatchItems,
  sessionEvents,
  taskRuns,
} from "@bob/db/schema";

import type { HandlerContext } from "../../handlers/context";
import {
  setIssueStatus,
  type PlanningIssueStatus,
} from "../integrations/planningWriteService.js";

export const t3RuntimeStatusValues = [
  "started",
  "working",
  "blocked",
  "review_ready",
  "completed",
  "failed",
] as const;

export type T3RuntimeStatus = (typeof t3RuntimeStatusValues)[number];

export interface MirrorT3RuntimeEventInput {
  sessionId?: string;
  taskRunId?: string;
  threadId?: string;
  status: T3RuntimeStatus;
  message: string;
  details?: Record<string, unknown>;
}

function mapChatStatus(status: T3RuntimeStatus): string {
  if (status === "completed" || status === "failed") return "stopped";
  return "running";
}

function mapWorkflowStatus(status: T3RuntimeStatus): string {
  switch (status) {
    case "started":
    case "working":
      return "working";
    case "blocked":
      return "blocked";
    case "review_ready":
      return "awaiting_review";
    case "completed":
      return "completed";
    case "failed":
      return "blocked";
  }
}

function mapTaskRunStatus(status: T3RuntimeStatus): string {
  switch (status) {
    case "started":
    case "working":
    case "review_ready":
      return "running";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

function mapPlanningIssueStatus(
  status: T3RuntimeStatus,
): PlanningIssueStatus | null {
  switch (status) {
    case "started":
    case "working":
      return "in_progress";
    case "review_ready":
    case "completed":
      return "in_review";
    case "blocked":
    case "failed":
      return "blocked";
  }
}

async function triggerDispatchProgressForTaskRun(
  ctx: Pick<HandlerContext, "db" | "userId">,
  taskRunId: string,
) {
  const dispatchItem = await ctx.db.query.dispatchItems.findFirst({
    where: eq(dispatchItems.taskRunId, taskRunId),
  });
  if (!dispatchItem?.batchId || dispatchItem.status !== "running") {
    return;
  }

  try {
    const { dispatchCheckProgress } = await import("../../handlers/dispatch.js");
    await dispatchCheckProgress(ctx as HandlerContext, {
      batchId: dispatchItem.batchId,
    });
  } catch (error) {
    console.error("[t3code] Failed to advance dispatch progress after runtime event:", error);
  }
}

export async function mirrorT3RuntimeEvent(
  ctx: Pick<HandlerContext, "db" | "userId">,
  input: MirrorT3RuntimeEventInput,
): Promise<{ ok: true }> {
  const taskRun = input.taskRunId
    ? await ctx.db.query.taskRuns.findFirst({
        where: eq(taskRuns.id, input.taskRunId),
      })
    : input.sessionId
      ? await ctx.db.query.taskRuns.findFirst({
          where: eq(taskRuns.sessionId, input.sessionId),
        })
      : null;

  const sessionId = input.sessionId ?? taskRun?.sessionId;
  if (!sessionId) {
    throw new Error("Session not found");
  }

  const session = await ctx.db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, sessionId),
  });
  if (!session || session.userId !== ctx.userId) {
    throw new Error("Session not found");
  }

  const now = new Date();
  const chatUpdates: Record<string, unknown> = {
    status: mapChatStatus(input.status),
    workflowStatus: mapWorkflowStatus(input.status),
    statusMessage: input.message,
    lastActivityAt: now,
  };
  if (input.status === "blocked" || input.status === "failed") {
    chatUpdates.blockedReason = input.message;
  }

  await ctx.db
    .update(chatConversations)
    .set(chatUpdates)
    .where(eq(chatConversations.id, sessionId));

  const nextSeq = session.nextSeq;
  await ctx.db
    .update(chatConversations)
    .set({ nextSeq: nextSeq + 1 })
    .where(eq(chatConversations.id, sessionId));

  await ctx.db.insert(sessionEvents).values({
    sessionId,
    seq: nextSeq,
    direction: "system",
    eventType: "state",
    payload: {
      type: "t3_runtime_event",
      status: input.status,
      message: input.message,
      threadId: input.threadId,
      taskRunId: taskRun?.id ?? input.taskRunId,
      details: input.details,
    },
  });

  if (taskRun) {
    const taskRunUpdates: Record<string, unknown> = {
      status: mapTaskRunStatus(input.status),
    };
    if (input.status === "blocked" || input.status === "failed") {
      taskRunUpdates.blockedReason = input.message;
    }
    if (input.status === "completed") {
      taskRunUpdates.completedAt = now;
    }

    await ctx.db
      .update(taskRuns)
      .set(taskRunUpdates)
      .where(eq(taskRuns.id, taskRun.id));

    if (input.status === "completed" || input.status === "failed") {
      await triggerDispatchProgressForTaskRun(ctx, taskRun.id);
    }
  }

  const planningStatus = mapPlanningIssueStatus(input.status);
  if (planningStatus) {
    try {
      await setIssueStatus({
        userId: ctx.userId,
        sessionId,
        status: planningStatus,
      });
    } catch (error) {
      console.error("[t3code] Failed to sync runtime status to planning provider:", error);
    }
  }

  return { ok: true };
}
