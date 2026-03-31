import type { TRPCRouterRecord } from "@trpc/server";
import { and, desc, eq, lt } from "@bob/db";
import { db } from "@bob/db/client";
import { webhookConfigs, webhookDeliveries, workspaceMembers } from "@bob/db/schema";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { emitWebhookEvent } from "../services/webhooks/webhookDeliveryService";
import { protectedProcedure } from "../trpc";

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

export const webhookRouter = {
  // List webhook configs for the current user
  list: protectedProcedure
    .input(
      z
        .object({
          workspaceId: z.string().uuid().optional(),
          activeOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(webhookConfigs.userId, ctx.session.user.id)];
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
    }),

  // Get a single webhook config by ID
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select()
        .from(webhookConfigs)
        .where(
          and(
            eq(webhookConfigs.id, input.id),
            eq(webhookConfigs.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    }),

  // Create a new webhook config
  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid().optional(),
        url: z.string().url(),
        secret: z.string().min(16),
        events: z.array(z.string()).default([]),
        active: z.boolean().default(true),
        description: z.string().max(256).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.workspaceId) {
        await assertWorkspaceAccess(ctx.session.user.id, input.workspaceId);
      }

      const [row] = await db
        .insert(webhookConfigs)
        .values({
          userId: ctx.session.user.id,
          ...input,
        })
        .returning();

      return row!;
    }),

  // Update an existing webhook config
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        url: z.string().url().optional(),
        secret: z.string().min(16).optional(),
        events: z.array(z.string()).optional(),
        active: z.boolean().optional(),
        description: z.string().max(256).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      const [row] = await db
        .update(webhookConfigs)
        .set(updates)
        .where(
          and(
            eq(webhookConfigs.id, id),
            eq(webhookConfigs.userId, ctx.session.user.id),
          ),
        )
        .returning();

      return row ?? null;
    }),

  // Delete a webhook config
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .delete(webhookConfigs)
        .where(
          and(
            eq(webhookConfigs.id, input.id),
            eq(webhookConfigs.userId, ctx.session.user.id),
          ),
        )
        .returning();

      return row ?? null;
    }),

  // List deliveries for a webhook config with cursor pagination
  deliveries: protectedProcedure
    .input(
      z.object({
        configId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify the config belongs to the user
      const config = await db
        .select({ id: webhookConfigs.id })
        .from(webhookConfigs)
        .where(
          and(
            eq(webhookConfigs.id, input.configId),
            eq(webhookConfigs.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (config.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook config not found" });
      }

      const conditions = [eq(webhookDeliveries.webhookConfigId, input.configId)];
      if (input.cursor) {
        conditions.push(lt(webhookDeliveries.receivedAt, new Date(input.cursor)));
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
        nextCursor: hasMore ? items.at(-1)!.receivedAt.toISOString() : null,
      };
    }),

  // Re-deliver a failed webhook delivery
  redeliver: protectedProcedure
    .input(z.object({ deliveryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
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
      if (!row || row.userId !== ctx.session.user.id) {
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
    }),

  // Send a test webhook event to a config
  testWebhook: protectedProcedure
    .input(z.object({ configId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const config = await db
        .select()
        .from(webhookConfigs)
        .where(
          and(
            eq(webhookConfigs.id, input.configId),
            eq(webhookConfigs.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (config.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook config not found" });
      }

      const results = await emitWebhookEvent(
        "webhook.test",
        ctx.session.user.id,
        { test: true, configId: input.configId, timestamp: new Date().toISOString() },
      );

      const result = results[0];
      return {
        success: result?.success ?? false,
        deliveryId: result?.deliveryId ?? null,
        error: result?.error ?? null,
      };
    }),
} satisfies TRPCRouterRecord;
