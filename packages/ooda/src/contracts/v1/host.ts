import { z } from "zod";

import { ConversationEventV1Schema } from "./events";

export const HostProviderV1Schema = z.enum(["grok", "claude", "openai"]);

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
