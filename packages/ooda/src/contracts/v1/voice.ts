import { z } from "zod";

export const TtsRequestModeV1Schema = z.enum(["automatic", "manual"]);
export type TtsRequestModeV1 = z.infer<typeof TtsRequestModeV1Schema>;

export const CreateTtsGrantInputV1Schema = z
  .object({
    conversationId: z.string().min(1),
    eventId: z.string().min(1),
    requestMode: TtsRequestModeV1Schema,
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict();

export type CreateTtsGrantInputV1 = z.infer<
  typeof CreateTtsGrantInputV1Schema
>;

export const CreateTtsGrantResultV1Schema = z
  .object({
    grantId: z.string().min(1),
    streamUrl: z.string().url(),
    expiresAt: z.iso.datetime({ offset: true }),
    replayed: z.boolean(),
  })
  .strict();

export type CreateTtsGrantResultV1 = z.infer<
  typeof CreateTtsGrantResultV1Schema
>;
