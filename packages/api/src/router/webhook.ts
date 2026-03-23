import type { TRPCRouterRecord } from "@trpc/server";
import { and, desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { webhookConfigs, webhookDeliveries } from "@bob/db/schema";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";

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

  // List deliveries for a webhook config
  listDeliveries: protectedProcedure
    .input(
      z.object({
        webhookConfigId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify the config belongs to the user
      const config = await db
        .select({ id: webhookConfigs.id })
        .from(webhookConfigs)
        .where(
          and(
            eq(webhookConfigs.id, input.webhookConfigId),
            eq(webhookConfigs.userId, ctx.session.user.id),
          ),
        )
        .limit(1);

      if (config.length === 0) return [];

      return db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.webhookConfigId, input.webhookConfigId))
        .orderBy(desc(webhookDeliveries.receivedAt))
        .limit(input.limit);
    }),
} satisfies TRPCRouterRecord;
