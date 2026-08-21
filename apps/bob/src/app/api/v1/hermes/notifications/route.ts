import { and, eq, lt, or, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { webhookDeliveries } from "@bob/db/schema";
import {
  createDeliveryLedger,
  handleSkillfleetNotification,
  type DeliveryRepository,
  type SkillfleetNotification,
} from "~/lib/hermes-notifications";

const PROVIDER = "skillfleet";

function requiredSecret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

const repository: DeliveryRepository = {
  async insert(idempotencyKey, payload) {
    const rows = await db
      .insert(webhookDeliveries)
      .values({
        provider: PROVIDER,
        deliveryId: idempotencyKey,
        eventType: payload.event,
        action: payload.deliveryClass,
        signatureValid: true,
        payload,
        status: "pending",
      })
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.id });
    return rows.length === 1;
  },

  async find(idempotencyKey) {
    const row = await db.query.webhookDeliveries.findFirst({
      columns: { payload: true, status: true, receivedAt: true },
      where: and(
        eq(webhookDeliveries.provider, PROVIDER),
        eq(webhookDeliveries.deliveryId, idempotencyKey),
      ),
    });
    return row
      ? {
          payload: row.payload as SkillfleetNotification,
          status: row.status,
          receivedAt: row.receivedAt,
        }
      : undefined;
  },

  async reclaim(idempotencyKey, staleBefore) {
    const reclaimedAt = new Date().toISOString();
    const rows = await db
      .update(webhookDeliveries)
      .set({
        status: "pending",
        errorMessage: null,
        receivedAt: reclaimedAt,
        retryCount: sql`${webhookDeliveries.retryCount} + 1`,
      })
      .where(
        and(
          eq(webhookDeliveries.provider, PROVIDER),
          eq(webhookDeliveries.deliveryId, idempotencyKey),
          or(
            eq(webhookDeliveries.status, "failed"),
            and(
              eq(webhookDeliveries.status, "pending"),
              lt(webhookDeliveries.receivedAt, staleBefore),
            ),
          ),
        ),
      )
      .returning({ id: webhookDeliveries.id });
    return rows.length === 1;
  },

  async markProcessed(idempotencyKey) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "processed",
        errorMessage: null,
        processedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(webhookDeliveries.provider, PROVIDER),
          eq(webhookDeliveries.deliveryId, idempotencyKey),
        ),
      );
  },

  async markFailed(idempotencyKey, message) {
    await db
      .update(webhookDeliveries)
      .set({ status: "failed", errorMessage: message })
      .where(
        and(
          eq(webhookDeliveries.provider, PROVIDER),
          eq(webhookDeliveries.deliveryId, idempotencyKey),
        ),
      );
  },
};

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleSkillfleetNotification(request, {
      ingressSecret: requiredSecret("SKILLFLEET_NOTIFICATION_SECRET"),
      hermesOriginToken: requiredSecret("HERMES_ORIGIN_TOKEN"),
      hermesOrigin: process.env.HERMES_ORIGIN_URL ?? "https://claude.gmac.io",
      ledger: createDeliveryLedger(repository),
    });
  } catch (error) {
    console.error("[hermes-notification] ingress unavailable", error);
    return Response.json({ error: "notification_ingress_unavailable" }, { status: 503 });
  }
}
