import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "./routers/index";

export { appRouter, type AppRouter } from "./routers/index";
export { createContext, type Context } from "./context";
export { router, publicProcedure, protectedProcedure } from "./trpc";
export {
  buildIssuePayload,
  dispatchWebhook,
  type OutboundWebhookEvent,
  type WebhookIssuePayload,
  type WebhookPayload,
  type WebhookProjectPayload,
  type WebhookWorkspacePayload,
} from "./services/outbound-webhook";

// Export inferred types for use in clients
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
