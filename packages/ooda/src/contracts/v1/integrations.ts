import { z } from "zod";

export const ExternalLinkV1Schema = z
  .object({
    id: z.string().min(1),
    proposalId: z.string().min(1).optional(),
    conversationId: z.string().min(1).optional(),
    destination: z.string().min(1).max(128),
    externalType: z.string().min(1).max(128),
    externalId: z.string().min(1).max(1_024),
    deepLink: z.string().url().max(4_096),
    idempotencyKey: z.string().min(1).max(256),
    status: z.enum(["active", "completed", "cancelled", "failed"]),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((link) => link.proposalId !== undefined || link.conversationId !== undefined, {
    message: "An external link must belong to a proposal or conversation",
  });

export type ExternalLinkV1 = z.infer<typeof ExternalLinkV1Schema>;

export const ExternalReceiptV1Schema = z
  .object({
    destination: z.string().min(1).max(128),
    externalType: z.string().min(1).max(128),
    externalId: z.string().min(1).max(1_024),
    deepLink: z.string().url().max(4_096),
    idempotencyKey: z.string().min(1).max(256),
    status: z.enum(["accepted", "completed", "cancelled", "failed"]),
    metadata: z.record(z.string(), z.unknown()),
    recordedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ExternalReceiptV1 = z.infer<typeof ExternalReceiptV1Schema>;

export const DeliveryAttemptV1Schema = z
  .object({
    id: z.string().min(1),
    outboxId: z.string().min(1),
    attempt: z.number().int().positive(),
    status: z.enum(["started", "succeeded", "ambiguous", "failed"]),
    error: z.string().max(20_000).optional(),
    receipt: ExternalReceiptV1Schema.optional(),
    startedAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export type DeliveryAttemptV1 = z.infer<typeof DeliveryAttemptV1Schema>;

export interface InspectInput {
  proposalId?: string;
  externalLinkId?: string;
}

export interface ContextReceipt {
  destination: string;
  observedAt: string;
  context: Record<string, unknown>;
}

export interface ValidationReceipt {
  valid: boolean;
  errors: string[];
  checkedAt: string;
}

export interface ExternalStatus {
  status: string;
  observedAt: string;
  metadata: Record<string, unknown>;
}

export interface DomainAdapter {
  inspect(input: InspectInput): Promise<ContextReceipt>;
  validateProposal(proposal: import("./proposals").ProposalV1): Promise<ValidationReceipt>;
  commit(
    proposal: import("./proposals").ProposalV1,
    idempotencyKey: string,
  ): Promise<ExternalReceiptV1>;
  lookupByIdempotencyKey(key: string): Promise<ExternalReceiptV1 | null>;
  readStatus(link: ExternalLinkV1): Promise<ExternalStatus>;
  cancel?(link: ExternalLinkV1): Promise<ExternalReceiptV1>;
}
