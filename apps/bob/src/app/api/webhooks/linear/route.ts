import { NextResponse } from "next/server";
import { eq, and } from "@bob/db";
import { db } from "@bob/db/client";
import { workspaceIntegrations } from "@bob/db/schema";
import { verifyLinearSignature } from "@bob/api/services/webhooks/verify";
import {
  recordWebhookDelivery,
} from "@bob/api/services/webhooks/processWebhook";
import { processLinearWebhook } from "@bob/api/services/webhooks/processLinearWebhook";

export async function POST(request: Request) {
  const signature = request.headers.get("linear-signature");
  const deliveryId = request.headers.get("linear-delivery") ?? crypto.randomUUID();
  const rawBody = await request.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = (payload.action as string) ?? null;
  const eventType = (payload.type as string) ?? "unknown";
  const teamId = (payload.data as any)?.team?.id as string | undefined;

  if (!teamId) {
    return NextResponse.json({ error: "Missing team ID" }, { status: 400 });
  }

  const integration = await db
    .select({ webhookSigningSecret: workspaceIntegrations.webhookSigningSecret })
    .from(workspaceIntegrations)
    .where(
      and(
        eq(workspaceIntegrations.provider, "linear"),
        eq(workspaceIntegrations.enabled, true),
        eq(workspaceIntegrations.linearTeamId, teamId),
      ),
    )
    .then((rows) => rows[0]);

  if (!integration) {
    return NextResponse.json({ error: "No integration for team" }, { status: 404 });
  }

  const secret = integration.webhookSigningSecret;
  const signatureValid = secret
    ? verifyLinearSignature(rawBody, signature, secret)
    : true;

  if (!signatureValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const recordId = await recordWebhookDelivery({
    provider: "linear",
    deliveryId,
    eventType,
    action,
    signatureValid,
    headers,
    payload,
  });

  if (!recordId) {
    return NextResponse.json({ ok: true, deduplicated: true });
  }

  try {
    await processLinearWebhook(eventType, payload, recordId);
  } catch (error) {
    console.error("[webhook:linear] Processing failed:", error);
  }

  return NextResponse.json({ ok: true });
}
