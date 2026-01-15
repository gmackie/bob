import { NextResponse } from "next/server";

import {
  processGiteaWebhook,
  recordWebhookDelivery,
} from "@bob/api/services/webhooks/processWebhook";
import { verifyGiteaSignature } from "@bob/api/services/webhooks/verify";

const GITEA_WEBHOOK_SECRET = process.env.GITEA_WEBHOOK_SECRET;

export async function POST(request: Request): Promise<NextResponse> {
  const deliveryId = request.headers.get("X-Gitea-Delivery");
  const eventType = request.headers.get("X-Gitea-Event");
  const signature = request.headers.get("X-Gitea-Signature");
  const instanceUrl = request.headers.get("X-Gitea-Instance");

  if (!eventType) {
    return NextResponse.json(
      { error: "Missing X-Gitea-Event header" },
      { status: 400 },
    );
  }

  if (!instanceUrl) {
    return NextResponse.json(
      { error: "Missing X-Gitea-Instance header" },
      { status: 400 },
    );
  }

  const body = await request.text();

  let signatureValid = false;
  if (GITEA_WEBHOOK_SECRET) {
    signatureValid = verifyGiteaSignature(
      body,
      signature,
      GITEA_WEBHOOK_SECRET,
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
    if (key.startsWith("x-gitea") || key === "content-type") {
      headers[key] = value;
    }
  });

  const recordId = await recordWebhookDelivery({
    provider: "gitea",
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
    await processGiteaWebhook(eventType, payload, recordId, instanceUrl);
    return NextResponse.json({ status: "processed", deliveryId: recordId });
  } catch (error) {
    console.error("Gitea webhook processing error:", error);
    return NextResponse.json(
      { status: "error", deliveryId: recordId },
      { status: 500 },
    );
  }
}
