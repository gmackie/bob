/**
 * Webhook handler functions — pure business logic extracted from the tRPC
 * webhook router.
 *
 * Phase 7B-4D-beta Task 5.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt } from "@bob/db";
import { db } from "@bob/db/client";
import { webhookConfigs, webhookDeliveries, workspaceMembers } from "@bob/db/schema";

import { emitWebhookEvent } from "../services/webhooks/webhookDeliveryService";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

async function assertWorkspaceAccess(userId: string, workspaceId: string) {
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function webhookList(
  ctx: HandlerContext,
  input?: {
    workspaceId?: string;
    activeOnly?: boolean;
  },
) {
  const conditions = [eq(webhookConfigs.userId, ctx.userId)];
  if (input?.workspaceId) {
    conditions.push(eq(webhookConfigs.workspaceId, input.workspaceId));
  }
  if (input?.activeOnly) {
    conditions.push(eq(webhookConfigs.active, true));
  }

  return db
    .select()
    .from(webhookConfigs)
    .where(and(...conditions))
    .orderBy(desc(webhookConfigs.createdAt));
}

export async function webhookById(
  ctx: HandlerContext,
  input: { id: string },
) {
  const rows = await db
    .select()
    .from(webhookConfigs)
    .where(
      and(
        eq(webhookConfigs.id, input.id),
        eq(webhookConfigs.userId, ctx.userId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function webhookCreate(
  ctx: HandlerContext,
  input: {
    workspaceId?: string;
    url: string;
    secret: string;
    events: string[];
    active: boolean;
    description?: string;
  },
) {
  if (input.workspaceId) {
    await assertWorkspaceAccess(ctx.userId, input.workspaceId);
  }

  const [row] = await db
    .insert(webhookConfigs)
    .values({
      userId: ctx.userId,
      ...input,
    })
    .returning();

  return row!;
}

export async function webhookUpdate(
  ctx: HandlerContext,
  input: {
    id: string;
    url?: string;
    secret?: string;
    events?: string[];
    active?: boolean;
    description?: string;
  },
) {
  const { id, ...updates } = input;
  const [row] = await db
    .update(webhookConfigs)
    .set(updates)
    .where(
      and(
        eq(webhookConfigs.id, id),
        eq(webhookConfigs.userId, ctx.userId),
      ),
    )
    .returning();

  return row ?? null;
}

export async function webhookDelete(
  ctx: HandlerContext,
  input: { id: string },
) {
  const [row] = await db
    .delete(webhookConfigs)
    .where(
      and(
        eq(webhookConfigs.id, input.id),
        eq(webhookConfigs.userId, ctx.userId),
      ),
    )
    .returning();

  return row ?? null;
}

export async function webhookDeliveriesList(
  ctx: HandlerContext,
  input: {
    configId: string;
    limit: number;
    cursor?: string;
  },
) {
  // Verify the config belongs to the user
  const config = await db
    .select({ id: webhookConfigs.id })
    .from(webhookConfigs)
    .where(
      and(
        eq(webhookConfigs.id, input.configId),
        eq(webhookConfigs.userId, ctx.userId),
      ),
    )
    .limit(1);

  if (config.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Webhook config not found" });
  }

  const conditions = [eq(webhookDeliveries.webhookConfigId, input.configId)];
  if (input.cursor) {
    conditions.push(lt(webhookDeliveries.receivedAt, input.cursor));
  }

  const items = await db
    .select()
    .from(webhookDeliveries)
    .where(and(...conditions))
    .orderBy(desc(webhookDeliveries.receivedAt))
    .limit(input.limit + 1);

  const hasMore = items.length > input.limit;
  if (hasMore) items.pop();

  return {
    items,
    nextCursor: hasMore ? items.at(-1)!.receivedAt : null,
  };
}

export async function webhookRedeliver(
  ctx: HandlerContext,
  input: { deliveryId: string },
) {
  // Fetch delivery and verify ownership via the config
  const rows = await db
    .select({
      delivery: webhookDeliveries,
      userId: webhookConfigs.userId,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookConfigs, eq(webhookDeliveries.webhookConfigId, webhookConfigs.id))
    .where(eq(webhookDeliveries.id, input.deliveryId))
    .limit(1);

  const row = rows[0];
  if (!row || row.userId !== ctx.userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Delivery not found" });
  }
  if (row.delivery.status !== "failed") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only failed deliveries can be re-delivered" });
  }

  const [updated] = await db
    .update(webhookDeliveries)
    .set({
      status: "pending",
      errorMessage: null,
      retryCount: 0,
      nextRetryAt: null,
      processedAt: null,
    })
    .where(eq(webhookDeliveries.id, input.deliveryId))
    .returning();

  return updated!;
}

export async function webhookTestWebhook(
  ctx: HandlerContext,
  input: { configId: string },
) {
  const config = await db
    .select()
    .from(webhookConfigs)
    .where(
      and(
        eq(webhookConfigs.id, input.configId),
        eq(webhookConfigs.userId, ctx.userId),
      ),
    )
    .limit(1);

  if (config.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Webhook config not found" });
  }

  const results = await emitWebhookEvent(
    "webhook.test",
    ctx.userId,
    { test: true, configId: input.configId, timestamp: new Date().toISOString() },
  );

  const result = results[0];
  return {
    success: result?.success ?? false,
    deliveryId: result?.deliveryId ?? null,
    error: result?.error ?? null,
  };
}
