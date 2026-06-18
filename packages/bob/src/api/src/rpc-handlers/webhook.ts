/**
 * Effect-RPC handler functions for the webhook RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 5.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  webhookList,
  webhookById,
  webhookCreate,
  webhookUpdate,
  webhookDelete,
  webhookDeliveriesList,
  webhookRedeliver,
  webhookTestWebhook,
} from "../handlers/webhook.js";

export const makeWebhookRpcHandlers = (ctx: HandlerContext) => ({
  "webhook.list": ({
    payload,
  }: {
    payload?: {
      workspaceId?: string;
      activeOnly?: boolean;
    };
  }) => wrapHandler(webhookList, ctx, payload, "webhook"),

  "webhook.byId": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(webhookById, ctx, payload, "webhook"),

  "webhook.create": ({
    payload,
  }: {
    payload: {
      workspaceId?: string;
      url: string;
      secret: string;
      events: string[];
      active: boolean;
      description?: string;
    };
  }) => wrapHandler(webhookCreate, ctx, payload, "webhook"),

  "webhook.update": ({
    payload,
  }: {
    payload: {
      id: string;
      url?: string;
      secret?: string;
      events?: string[];
      active?: boolean;
      description?: string;
    };
  }) => wrapHandler(webhookUpdate, ctx, payload, "webhook"),

  "webhook.delete": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(webhookDelete, ctx, payload, "webhook"),

  "webhook.deliveries": ({
    payload,
  }: {
    payload: {
      configId: string;
      limit: number;
      cursor?: string;
    };
  }) => wrapHandler(webhookDeliveriesList, ctx, payload, "webhook"),

  "webhook.redeliver": ({
    payload,
  }: {
    payload: { deliveryId: string };
  }) => wrapHandler(webhookRedeliver, ctx, payload, "webhook"),

  "webhook.testWebhook": ({
    payload,
  }: {
    payload: { configId: string };
  }) => wrapHandler(webhookTestWebhook, ctx, payload, "webhook"),
});
