import { createHmac, randomUUID } from "node:crypto";
import { and, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { webhookConfigs, webhookDeliveries } from "@bob/db/schema";

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Sign a JSON payload with HMAC-SHA256 using the webhook config secret.
 * Returns the signature in "sha256=<hex>" format (GitHub-style).
 */
function signPayload(payload: string, secret: string): string {
  const hmac = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  return `sha256=${hmac}`;
}

interface DeliveryResult {
  deliveryId: string;
  configId: string;
  statusCode: number | null;
  success: boolean;
  error?: string;
}

/**
 * Emit a webhook event to all active webhook configs that subscribe to the given eventType.
 *
 * Looks up matching configs by userId (and optionally workspaceId),
 * creates a webhookDelivery record for each, POSTs the payload with an HMAC-SHA256 signature,
 * and retries on failure with exponential backoff.
 */
export async function emitWebhookEvent(
  eventType: string,
  userId: string,
  payload: Record<string, unknown>,
  workspaceId?: string,
): Promise<DeliveryResult[]> {
  const configs = await getMatchingConfigs(eventType, userId, workspaceId);
  if (configs.length === 0) return [];

  // Meter outbound deliveries against the tenant's webhook volume quota.
  const { assertWithinQuotaOrThrow } = await import("../quotas/index.js");
  await assertWithinQuotaOrThrow({
    db,
    userId,
    metric: "webhookVolume",
    delta: configs.length,
  });

  const envelope = {
    event: eventType,
    timestamp: new Date().toISOString(),
    payload,
  };

  const results = await Promise.allSettled(
    configs.map((config) => deliverToConfig(config, eventType, envelope)),
  );

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { deliveryId: "", configId: "", statusCode: null, success: false, error: String(r.reason) },
  );
}

async function getMatchingConfigs(
  eventType: string,
  userId: string,
  workspaceId?: string,
) {
  const conditions = [
    eq(webhookConfigs.userId, userId),
    eq(webhookConfigs.active, true),
  ];
  if (workspaceId) {
    conditions.push(eq(webhookConfigs.workspaceId, workspaceId));
  }

  const configs = await db.query.webhookConfigs.findMany({
    where: and(...conditions),
  });

  // Filter to configs that subscribe to this event (empty events array = subscribe to all)
  return configs.filter(
    (c) => c.events.length === 0 || c.events.includes(eventType),
  );
}

async function deliverToConfig(
  config: { id: string; url: string; secret: string },
  eventType: string,
  envelope: Record<string, unknown>,
): Promise<DeliveryResult> {
  const deliveryUuid = randomUUID();
  const body = JSON.stringify(envelope);
  const signature = signPayload(body, config.secret);

  // Create delivery record up front
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      webhookConfigId: config.id,
      provider: "outbound",
      deliveryId: deliveryUuid,
      eventType,
      signatureValid: true,
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Delivery": deliveryUuid,
        "X-Webhook-Event": eventType,
      },
      payload: envelope,
      status: "pending",
    })
    .returning({ id: webhookDeliveries.id });

  if (!delivery) {
    throw new Error("Failed to create webhook delivery record: insert returned no row");
  }

  const deliveryId = delivery.id;

  // Attempt delivery with retries
  let lastError: string | null = null;
  let lastStatusCode: number | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const lastConfiguredDelay = RETRY_DELAYS_MS.at(-1) ?? DELIVERY_TIMEOUT_MS;
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? lastConfiguredDelay;
      await sleep(delay);
    }

    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Delivery": deliveryUuid,
          "X-Webhook-Event": eventType,
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });

      lastStatusCode = response.status;

      if (response.ok) {
        await db
          .update(webhookDeliveries)
          .set({
            status: "processed",
            processedAt: new Date().toISOString(),
            retryCount: attempt,
          })
          .where(eq(webhookDeliveries.id, deliveryId));

        return {
          deliveryId,
          configId: config.id,
          statusCode: response.status,
          success: true,
        };
      }

      lastError = `HTTP ${response.status}: ${await response.text().catch(() => "")}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // All retries exhausted
  await db
    .update(webhookDeliveries)
    .set({
      status: "failed",
      errorMessage: lastError,
      retryCount: MAX_RETRIES,
    })
    .where(eq(webhookDeliveries.id, deliveryId));

  return {
    deliveryId,
    configId: config.id,
    statusCode: lastStatusCode,
    success: false,
    error: lastError ?? "Unknown error",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
