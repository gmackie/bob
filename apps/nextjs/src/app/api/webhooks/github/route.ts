import { NextResponse } from "next/server";

import {
  processGitHubWebhook,
  recordWebhookDelivery,
} from "@bob/api/services/webhooks/processWebhook";
import { verifyGitHubSignature } from "@bob/api/services/webhooks/verify";

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

export async function POST(request: Request): Promise<NextResponse> {
  const deliveryId = request.headers.get("X-GitHub-Delivery");
  const eventType = request.headers.get("X-GitHub-Event");
  const signature = request.headers.get("X-Hub-Signature-256");

  if (!eventType) {
    return NextResponse.json(
      { error: "Missing X-GitHub-Event header" },
      { status: 400 },
    );
  }

  const body = await request.text();

  let signatureValid = false;
  if (GITHUB_WEBHOOK_SECRET) {
    signatureValid = verifyGitHubSignature(
      body,
      signature,
      GITHUB_WEBHOOK_SECRET,
    );
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
    if (key.startsWith("x-github") || key === "content-type") {
      headers[key] = value;
    }
  });

  const recordId = await recordWebhookDelivery({
    provider: "github",
    deliveryId,
    eventType,
    action,
    signatureValid,
    headers,
    payload,
  });

  if (!recordId) {
    return NextResponse.json({ status: "duplicate", deliveryId });
  }

  try {
    await processGitHubWebhook(eventType, payload, recordId);
    return NextResponse.json({ status: "processed", deliveryId: recordId });
  } catch (error) {
    console.error("GitHub webhook processing error:", error);
    return NextResponse.json(
      { status: "error", deliveryId: recordId },
      { status: 500 },
    );
  }
}
