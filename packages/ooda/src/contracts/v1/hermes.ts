import { z } from "zod";

export const HermesCaptureInputV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().min(1).max(256),
    conversationId: z.string().min(1),
    branchId: z.string().min(1),
    text: z.string().min(1).max(8_000),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type HermesCaptureInputV1 = z.infer<typeof HermesCaptureInputV1Schema>;

export const HermesCaptureReceiptV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.string().min(1).max(256),
    replayed: z.boolean(),
    canonicalRef: z
      .object({
        kind: z.literal("conversation_event"),
        id: z.string().min(1),
      })
      .strict(),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type HermesCaptureReceiptV1 = z.infer<
  typeof HermesCaptureReceiptV1Schema
>;
