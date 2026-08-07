import { z } from "zod";

import { CursorPageInfoV1Schema, CursorV1Schema } from "./conversation";
import { ProposalV1Schema } from "./proposals";

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
  .refine(
    (link) =>
      link.proposalId !== undefined || link.conversationId !== undefined,
    {
      message: "An external link must belong to a proposal or conversation",
    },
  );

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
  validateProposal(
    proposal: import("./proposals").ProposalV1,
  ): Promise<ValidationReceipt>;
  commit(
    proposal: import("./proposals").ProposalV1,
    idempotencyKey: string,
  ): Promise<ExternalReceiptV1>;
  lookupByIdempotencyKey(key: string): Promise<ExternalReceiptV1 | null>;
  readStatus(link: ExternalLinkV1): Promise<ExternalStatus>;
  cancel?(link: ExternalLinkV1): Promise<ExternalReceiptV1>;
}

export const IntegrationDeliveryStatusV1Schema = z.enum([
  "pending",
  "delivering",
  "delivered",
  "dead_letter",
]);

export const IntegrationDeliveryV1Schema = z
  .object({
    id: z.string().min(1),
    proposalId: z.string().min(1),
    destination: z.string().min(1),
    idempotencyKey: z.string().min(1),
    status: IntegrationDeliveryStatusV1Schema,
    attemptCount: z.number().int().nonnegative(),
    availableAt: z.iso.datetime({ offset: true }),
    claimedAt: z.iso.datetime({ offset: true }).optional(),
    claimedBy: z.string().optional(),
    deliveredAt: z.iso.datetime({ offset: true }).optional(),
    lastError: z.string().optional(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type IntegrationDeliveryV1 = z.infer<typeof IntegrationDeliveryV1Schema>;

export const ClaimIntegrationDeliveryInputV1Schema = z
  .object({
    runnerId: z.string().min(1).max(256),
    destinations: z.array(z.string().min(1).max(128)).min(1).max(32),
    leaseSeconds: z.number().int().min(10).max(600).default(90),
  })
  .strict();
export type ClaimIntegrationDeliveryInputV1 = z.infer<
  typeof ClaimIntegrationDeliveryInputV1Schema
>;

export const ClaimIntegrationDeliveryResultV1Schema = z
  .object({
    delivery: IntegrationDeliveryV1Schema,
    proposal: ProposalV1Schema,
  })
  .strict()
  .nullable();
export type ClaimIntegrationDeliveryResultV1 = z.infer<
  typeof ClaimIntegrationDeliveryResultV1Schema
>;

export const CompleteIntegrationDeliveryInputV1Schema = z
  .object({
    outboxId: z.string().min(1),
    runnerId: z.string().min(1).max(256),
    receipt: ExternalReceiptV1Schema,
  })
  .strict();
export type CompleteIntegrationDeliveryInputV1 = z.infer<
  typeof CompleteIntegrationDeliveryInputV1Schema
>;

export const FailIntegrationDeliveryInputV1Schema = z
  .object({
    outboxId: z.string().min(1),
    runnerId: z.string().min(1).max(256),
    classification: z.enum(["ambiguous", "failed"]),
    error: z.string().min(1).max(20_000),
    retryable: z.boolean(),
  })
  .strict();
export type FailIntegrationDeliveryInputV1 = z.infer<
  typeof FailIntegrationDeliveryInputV1Schema
>;

export const IntegrationDeliveryMutationResultV1Schema = z
  .object({
    delivery: IntegrationDeliveryV1Schema,
    externalLink: ExternalLinkV1Schema.optional(),
  })
  .strict();
export type IntegrationDeliveryMutationResultV1 = z.infer<
  typeof IntegrationDeliveryMutationResultV1Schema
>;

export const IntegrationDeliveryListInputV1Schema = z
  .object({
    conversationId: z.string().min(1),
    status: IntegrationDeliveryStatusV1Schema.optional(),
    cursor: CursorV1Schema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type IntegrationDeliveryListInputV1 = z.infer<
  typeof IntegrationDeliveryListInputV1Schema
>;

export const IntegrationDeliveryListPageV1Schema = z
  .object({
    items: z.array(IntegrationDeliveryV1Schema),
    pageInfo: CursorPageInfoV1Schema,
  })
  .strict();
export type IntegrationDeliveryListPageV1 = z.infer<
  typeof IntegrationDeliveryListPageV1Schema
>;

export const DeadLetterV1Schema = z
  .object({
    id: z.string().min(1),
    outboxId: z.string().min(1),
    reason: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
    repairedAt: z.iso.datetime({ offset: true }).optional(),
    repairedBy: z.string().optional(),
    repairNote: z.string().optional(),
  })
  .strict();
export type DeadLetterV1 = z.infer<typeof DeadLetterV1Schema>;

export const RepairDeadLetterInputV1Schema = z
  .object({
    deadLetterId: z.string().min(1),
    note: z.string().min(1).max(10_000),
    idempotencyKey: z.string().min(1).max(256),
    repairedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type RepairDeadLetterInputV1 = z.infer<
  typeof RepairDeadLetterInputV1Schema
>;

export const DeadLetterListInputV1Schema = z
  .object({
    conversationId: z.string().min(1),
    cursor: CursorV1Schema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export const DeadLetterListPageV1Schema = z
  .object({
    items: z.array(DeadLetterV1Schema),
    pageInfo: CursorPageInfoV1Schema,
  })
  .strict();

export const RepairDeadLetterResultV1Schema = z
  .object({
    deadLetter: DeadLetterV1Schema,
    delivery: IntegrationDeliveryV1Schema,
    replayed: z.boolean(),
  })
  .strict();
export type RepairDeadLetterResultV1 = z.infer<
  typeof RepairDeadLetterResultV1Schema
>;
