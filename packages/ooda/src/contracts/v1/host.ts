import { z } from "zod";

import { SensitivityV1Schema } from "./conversation";
import { ConversationEventV1Schema } from "./events";

export const HostProviderV1Schema = z.enum(["grok", "claude", "openai"]);
export type HostProviderV1 = z.infer<typeof HostProviderV1Schema>;

export const HostProviderFailureV1Schema = z
  .object({
    provider: HostProviderV1Schema,
    code: z.enum(["PROVIDER_UNAVAILABLE", "PROVIDER_FAILED"]),
  })
  .strict();

export const CreateHostTurnInputV1Schema = z
  .object({
    conversationId: z.string().min(1),
    userEventId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict();

export type CreateHostTurnInputV1 = z.infer<typeof CreateHostTurnInputV1Schema>;

export const CreateHostTurnResultV1Schema = z
  .object({
    assistantEvent: ConversationEventV1Schema,
    provider: HostProviderV1Schema,
    model: z.string().min(1).max(256),
    providerResponseId: z.string().min(1).max(1_024),
    contextPackId: z.string().min(1).optional(),
    replayed: z.boolean(),
    fallback: z
      .object({
        preferredProvider: HostProviderV1Schema,
        failures: z.array(HostProviderFailureV1Schema).min(1).max(3),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CreateHostTurnResultV1 = z.infer<
  typeof CreateHostTurnResultV1Schema
>;

export const HostTurnQueueStatusV1Schema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const EnqueueHostTurnResultV1Schema = z
  .object({
    executionId: z.string().min(1),
    status: HostTurnQueueStatusV1Schema,
    contextPackId: z.string().min(1).optional(),
    assistantEventId: z.string().min(1).optional(),
    replayed: z.boolean(),
  })
  .strict();
export type EnqueueHostTurnResultV1 = z.infer<
  typeof EnqueueHostTurnResultV1Schema
>;

export const HostMessageV1Schema = z
  .object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) })
  .strict();

export const RuntimeSessionRefV1Schema = z
  .object({
    provider: HostProviderV1Schema,
    sessionId: z.string().min(1),
    turnId: z.string().min(1).optional(),
    transport: z.enum(["cli", "app_server", "acp"]),
    authMode: z.enum(["subscription", "api_key"]),
  })
  .strict();

export const ClaimHostTurnInputV1Schema = z
  .object({
    runnerId: z.string().min(1).max(256),
    providers: z.array(HostProviderV1Schema).min(1).max(3),
    leaseSeconds: z.number().int().min(30).max(300).default(90),
  })
  .strict();
export type ClaimHostTurnInputV1 = z.infer<typeof ClaimHostTurnInputV1Schema>;

export const ClaimHostTurnResultV1Schema = z
  .object({
    executionId: z.string().min(1),
    conversationId: z.string().min(1),
    userEventId: z.string().min(1),
    contextPackId: z.string().min(1),
    preferredProvider: HostProviderV1Schema,
    providerOrder: z.array(HostProviderV1Schema).min(1).max(3),
    messages: z.array(HostMessageV1Schema).min(1).max(2_000),
    system: z.string().min(1).max(100_000),
    sensitivity: SensitivityV1Schema,
    correlationId: z.string().min(1).max(256),
    runtimeSession: RuntimeSessionRefV1Schema.optional(),
    attempt: z.number().int().positive(),
    leaseToken: z.string().uuid(),
  })
  .strict()
  .nullable();
export type ClaimHostTurnResultV1 = z.infer<typeof ClaimHostTurnResultV1Schema>;

export const CompleteHostTurnInputV1Schema = z
  .object({
    executionId: z.string().min(1),
    runnerId: z.string().min(1).max(256),
    leaseToken: z.string().uuid(),
    provider: HostProviderV1Schema,
    model: z.string().min(1).max(256),
    providerResponseId: z.string().min(1).max(1_024),
    response: z.string().min(1).max(1_000_000),
    runtimeSession: RuntimeSessionRefV1Schema.optional(),
    failures: z.array(HostProviderFailureV1Schema).max(3).default([]),
    idempotencyKey: z.string().min(1).max(256),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type CompleteHostTurnInputV1 = z.infer<
  typeof CompleteHostTurnInputV1Schema
>;

export const FailHostTurnInputV1Schema = z
  .object({
    executionId: z.string().min(1),
    runnerId: z.string().min(1).max(256),
    leaseToken: z.string().uuid(),
    failures: z.array(HostProviderFailureV1Schema).min(1).max(3),
    error: z.string().min(1).max(20_000),
    idempotencyKey: z.string().min(1).max(256),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type FailHostTurnInputV1 = z.infer<typeof FailHostTurnInputV1Schema>;

export const FailHostTurnResultV1Schema = z
  .object({
    executionId: z.string().min(1),
    status: z.literal("failed"),
    replayed: z.boolean(),
  })
  .strict();
