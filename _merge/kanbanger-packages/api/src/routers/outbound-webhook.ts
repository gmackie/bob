import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { outboundWebhooks, outboundWebhookDeliveries } from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";
import crypto from "crypto";
import {
  dispatchWebhook,
  type OutboundWebhookEvent,
} from "../services/outbound-webhook";

const webhookEventEnum = z.enum([
  "issue.created",
  "issue.updated",
  "issue.deleted",
  "issue.status_changed",
  "issue.completed",
  "issue.funnel_stage_changed",
  "comment.created",
]);

const createWebhookInput = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(webhookEventEnum).min(1),
  projectIds: z.array(z.string().uuid()).optional(),
  enabled: z.boolean().default(true),
});

const updateWebhookInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  events: z.array(webhookEventEnum).min(1).optional(),
  projectIds: z.array(z.string().uuid()).nullish(),
  enabled: z.boolean().optional(),
});

export const outboundWebhookRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const webhooks = await ctx.db
        .select({
          id: outboundWebhooks.id,
          name: outboundWebhooks.name,
          url: outboundWebhooks.url,
          events: outboundWebhooks.events,
          projectIds: outboundWebhooks.projectIds,
          enabled: outboundWebhooks.enabled,
          createdAt: outboundWebhooks.createdAt,
          updatedAt: outboundWebhooks.updatedAt,
        })
        .from(outboundWebhooks)
        .where(eq(outboundWebhooks.workspaceId, input.workspaceId))
        .orderBy(desc(outboundWebhooks.createdAt));

      return webhooks;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [webhook] = await ctx.db
        .select()
        .from(outboundWebhooks)
        .where(eq(outboundWebhooks.id, input.id))
        .limit(1);

      return webhook ?? null;
    }),

  create: protectedProcedure
    .input(createWebhookInput)
    .mutation(async ({ ctx, input }) => {
      const secret = crypto.randomBytes(32).toString("hex");

      const [webhook] = await ctx.db
        .insert(outboundWebhooks)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          url: input.url,
          secret,
          events: input.events,
          projectIds: input.projectIds ?? [],
          enabled: input.enabled,
        })
        .returning();

      return {
        ...webhook,
        secret,
      };
    }),

  update: protectedProcedure
    .input(updateWebhookInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const updateData: Record<string, unknown> = {};

      if (data.name !== undefined) updateData.name = data.name;
      if (data.url !== undefined) updateData.url = data.url;
      if (data.events !== undefined) updateData.events = data.events;
      if (data.projectIds !== undefined)
        updateData.projectIds = data.projectIds ?? [];
      if (data.enabled !== undefined) updateData.enabled = data.enabled;

      const [webhook] = await ctx.db
        .update(outboundWebhooks)
        .set(updateData)
        .where(eq(outboundWebhooks.id, id))
        .returning();

      return webhook;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(outboundWebhooks)
        .where(eq(outboundWebhooks.id, input.id));

      return { success: true };
    }),

  regenerateSecret: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const secret = crypto.randomBytes(32).toString("hex");

      const [webhook] = await ctx.db
        .update(outboundWebhooks)
        .set({ secret })
        .where(eq(outboundWebhooks.id, input.id))
        .returning();

      return {
        ...webhook,
        secret,
      };
    }),

  deliveries: protectedProcedure
    .input(
      z.object({
        webhookId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const deliveries = await ctx.db
        .select()
        .from(outboundWebhookDeliveries)
        .where(eq(outboundWebhookDeliveries.webhookId, input.webhookId))
        .orderBy(desc(outboundWebhookDeliveries.deliveredAt))
        .limit(input.limit);

      return deliveries;
    }),

  test: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [webhook] = await ctx.db
        .select()
        .from(outboundWebhooks)
        .where(eq(outboundWebhooks.id, input.id))
        .limit(1);

      if (!webhook) {
        throw new Error("Webhook not found");
      }

      const testIssue = {
        id: "00000000-0000-0000-0000-000000000000",
        identifier: "TEST-1",
        title: "Test webhook delivery",
        description: "This is a test webhook delivery",
        status: "todo",
        priority: "medium",
        type: "issue",
        projectId: "00000000-0000-0000-0000-000000000000",
        assigneeId: null,
        creatorId: "00000000-0000-0000-0000-000000000000",
        funnelSourceType: "manual",
        funnelSourceId: null,
        funnelSourceUrl: null,
        funnelTshirtSize: null,
        funnelArtifactType: "task",
        funnelStage: "dumped",
        funnelMetadata: null,
        dueDate: null,
        estimate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await dispatchWebhook(
        ctx.db,
        webhook.workspaceId,
        testIssue.projectId,
        "issue.created" as OutboundWebhookEvent,
        testIssue
      );

      return { success: true };
    }),
});
