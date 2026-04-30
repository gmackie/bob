// @bob/webhooks/schema — Webhook tables extracted from @bob/db/schema
// Phase 7B-2 Task 16.

import { relations, sql } from "drizzle-orm";
import { index, pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { user } from "@bob/auth/schema";
import { webhookStatusEnum } from "@bob/git/schema";
import { workspaces } from "@bob/tenancy/schema";

// 1.4a Webhook Configs (outbound webhook subscriptions)
export const webhookConfigs = pgTable(
  "webhook_configs",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: t
      .uuid()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    url: t.text().notNull(),
    secret: t.text().notNull(),
    events: t.json().$type<string[]>().notNull().default([]),
    active: t.boolean().notNull().default(true),
    description: t.text(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "string", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("webhook_configs_user_id_idx").on(table.userId),
    index("webhook_configs_workspace_id_idx").on(table.workspaceId),
  ],
);

export const CreateWebhookConfigSchema = createInsertSchema(webhookConfigs, {
  url: z.string().url(),
  secret: z.string().min(16),
  events: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  description: z.string().max(256).optional(),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

// 1.4b Webhook Deliveries (idempotency + audit)
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    webhookConfigId: t
      .uuid()
      .references(() => webhookConfigs.id, { onDelete: "set null" }),
    provider: t.varchar({ length: 20 }).notNull(), // 'github' | 'gitlab' | 'gitea' | 'planning'
    deliveryId: t.text(), // X-GitHub-Delivery, X-Gitea-Delivery, etc.
    eventType: t.varchar({ length: 50 }).notNull(), // e.g., 'pull_request', 'push'
    action: t.varchar({ length: 50 }), // e.g., 'opened', 'closed', 'merged'
    signatureValid: t.boolean().notNull(),
    headers: t.json().$type<Record<string, string>>(),
    payload: t.json().$type<Record<string, unknown>>().notNull(),
    status: t.varchar({ length: 20 }).notNull().default("pending"), // 'pending' | 'processed' | 'failed'
    errorMessage: t.text(),
    retryCount: t.integer().notNull().default(0),
    nextRetryAt: t.timestamp({ mode: "string", withTimezone: true }),
    processedAt: t.timestamp({ mode: "string", withTimezone: true }),
    receivedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    index("webhook_deliveries_config_id_idx").on(table.webhookConfigId),
  ],
);

export const CreateWebhookDeliverySchema = createInsertSchema(
  webhookDeliveries,
  {
    provider: z.string().max(20),
    deliveryId: z.string().optional(),
    eventType: z.string().max(50),
    action: z.string().max(50).optional(),
    signatureValid: z.boolean(),
    status: z.enum(webhookStatusEnum).default("pending"),
  },
).omit({
  id: true,
  receivedAt: true,
  processedAt: true,
});

export const webhookConfigsRelations = relations(
  webhookConfigs,
  ({ one, many }) => ({
    user: one(user, {
      fields: [webhookConfigs.userId],
      references: [user.id],
    }),
    workspace: one(workspaces, {
      fields: [webhookConfigs.workspaceId],
      references: [workspaces.id],
    }),
    deliveries: many(webhookDeliveries),
  }),
);

export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    webhookConfig: one(webhookConfigs, {
      fields: [webhookDeliveries.webhookConfigId],
      references: [webhookConfigs.id],
    }),
  }),
);
