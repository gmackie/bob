import { NextResponse } from "next/server";

import {
  markDeliveryFailed,
  markDeliveryProcessed,
  processKanbangerWebhook as processSharedKanbangerWebhook,
  recordWebhookDelivery,
} from "@bob/api/services/webhooks/processWebhook";
import { eq } from "@bob/db";
import { db } from "@bob/db/client";
import { user } from "@bob/db/schema";

import { env } from "~/env";
import type { KanbangerTask } from "~/lib/tasks/taskExecutor";
import { executeTask } from "~/lib/tasks/taskExecutor";

const KANBANGER_WEBHOOK_SECRET = env.KANBANGER_WEBHOOK_SECRET;

export async function POST(request: Request): Promise<NextResponse> {
  const eventType =
    request.headers.get("X-Webhook-Event") ??
    request.headers.get("X-Kanbanger-Event");
  const signature =
    request.headers.get("X-Webhook-Signature") ??
    request.headers.get("X-Kanbanger-Signature");
  const deliveryId =
    request.headers.get("X-Webhook-Delivery") ??
    request.headers.get("X-Kanbanger-Delivery");

  if (!eventType) {
    return NextResponse.json(
      { error: "Missing webhook event header" },
      { status: 400 },
    );
  }

  const body = await request.text();

  let signatureValid = true;
  if (KANBANGER_WEBHOOK_SECRET && signature) {
    const { createHmac, timingSafeEqual } = await import("node:crypto");
    const expectedDigest = createHmac("sha256", KANBANGER_WEBHOOK_SECRET)
      .update(body, "utf8")
      .digest("hex");
    const expectedSignature = `sha256=${expectedDigest}`;

    try {
      if (signature.startsWith("sha256=")) {
        signatureValid = timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expectedSignature),
        );
      } else {
        signatureValid = timingSafeEqual(
          Buffer.from(signature, "hex"),
          Buffer.from(expectedDigest, "hex"),
        );
      }
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
    if (
      key.startsWith("x-kanbanger") ||
      key.startsWith("x-webhook") ||
      key === "content-type"
    ) {
      headers[key] = value;
    }
  });

  const recordId = await recordWebhookDelivery({
    provider: "kanbanger",
    deliveryId,
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
    await processLegacyKanbangerWebhook(eventType, action, payload, recordId);
    return NextResponse.json({ status: "processed", deliveryId: recordId });
  } catch (error) {
    console.error("Kanbanger webhook processing error:", error);
    return NextResponse.json(
      { status: "error", deliveryId: recordId },
      { status: 500 },
    );
  }
}

async function processLegacyKanbangerWebhook(
  eventType: string,
  action: string | null,
  payload: Record<string, unknown>,
  deliveryId: string,
): Promise<void> {
  try {
    switch (eventType) {
      case "comment.created":
        await processSharedKanbangerWebhook(eventType, payload, deliveryId);
        return;
      case "task":
        if (action === "assigned") {
          await handleTaskAssigned(payload);
        }
        break;
      case "comment":
        if (action === "created") {
          await processSharedKanbangerWebhook("comment.created", payload, deliveryId);
          return;
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
  issue?: {
    id: string;
    identifier: string;
    title: string;
    description?: string;
  };
  workspace?: {
    id: string;
  };
  project?: {
    id: string;
  };
  assignee?: {
    id: string;
    email: string;
  };
  labels?: { name: string }[];
  priority?: number;
}

async function handleTaskAssigned(
  payload: Record<string, unknown>,
): Promise<void> {
  const data = payload as unknown as KanbangerTaskPayload;

  if (!(data.issue && data.workspace && data.assignee?.email)) {
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
