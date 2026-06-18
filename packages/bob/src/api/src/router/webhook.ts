import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  webhookList,
  webhookById,
  webhookCreate,
  webhookUpdate,
  webhookDelete,
  webhookDeliveriesList,
  webhookRedeliver,
  webhookTestWebhook,
} from "../handlers/webhook";

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
    .query(({ ctx, input }) =>
      webhookList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  // Get a single webhook config by ID
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      webhookById({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      webhookCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      webhookUpdate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  // Delete a webhook config
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      webhookDelete({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  // List deliveries for a webhook config with cursor pagination
  deliveries: protectedProcedure
    .input(
      z.object({
        configId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().datetime().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      webhookDeliveriesList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  // Re-deliver a failed webhook delivery
  redeliver: protectedProcedure
    .input(z.object({ deliveryId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      webhookRedeliver({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  // Send a test webhook event to a config
  testWebhook: protectedProcedure
    .input(z.object({ configId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      webhookTestWebhook({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
