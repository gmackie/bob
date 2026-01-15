import { NextResponse } from "next/server";

import {
  processGitLabWebhook,
  recordWebhookDelivery,
} from "@bob/api/services/webhooks/processWebhook";
import { verifyGitLabToken } from "@bob/api/services/webhooks/verify";

const GITLAB_WEBHOOK_TOKEN = process.env.GITLAB_WEBHOOK_TOKEN;

export async function POST(request: Request): Promise<NextResponse> {
  const eventType = request.headers.get("X-Gitlab-Event");
  const token = request.headers.get("X-Gitlab-Token");
  const instanceUrl = request.headers.get("X-Gitlab-Instance");

  if (!eventType) {
    return NextResponse.json(
      { error: "Missing X-Gitlab-Event header" },
      { status: 400 },
    );
  }

  let signatureValid = false;
  if (GITLAB_WEBHOOK_TOKEN) {
    signatureValid = verifyGitLabToken(token, GITLAB_WEBHOOK_TOKEN);
    if (!signatureValid) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
  }

  const body = await request.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key.startsWith("x-gitlab") || key === "content-type") {
      headers[key] = value;
    }
  });

  const recordId = await recordWebhookDelivery({
    provider: "gitlab",
    deliveryId: null,
    eventType,
    action: null,
    signatureValid,
    headers,
    payload,
  });

  if (!recordId) {
    return NextResponse.json({ status: "duplicate" });
  }

  try {
    await processGitLabWebhook(
      eventType,
      payload,
      recordId,
      instanceUrl ?? undefined,
    );
    return NextResponse.json({ status: "processed", deliveryId: recordId });
  } catch (error) {
    console.error("GitLab webhook processing error:", error);
    return NextResponse.json(
      { status: "error", deliveryId: recordId },
      { status: 500 },
    );
  }
}
