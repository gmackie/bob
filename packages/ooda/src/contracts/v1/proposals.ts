import { z } from "zod";

import { CursorPageInfoV1Schema, CursorV1Schema } from "./conversation";

export const ProposalKindV1Schema = z.enum([
  "obsidian_note",
  "research_job",
  "bob_task",
  "bob_project",
  "bizpulse_venture",
  "content_project",
  "fabrication_project",
  "hardware_validation",
  "mobile_release",
]);

export const ProposalStatusV1Schema = z.enum([
  "draft",
  "awaiting_approval",
  "approved",
  "delivering",
  "delivered",
  "rejected",
  "failed",
  "cancelled",
]);

export const ProposalRiskV1Schema = z.enum([
  "private_write",
  "durable_work",
  "external_write",
  "sensitive",
  "destructive",
]);

export const ProposalV1Schema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    kind: ProposalKindV1Schema,
    destination: z.string().min(1).max(128),
    status: ProposalStatusV1Schema,
    risk: ProposalRiskV1Schema,
    preview: z.record(z.string(), z.unknown()),
    rationale: z.string().min(1).max(20_000),
    confidence: z.number().min(0).max(1),
    policySnapshot: z.record(z.string(), z.unknown()),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.number().int().positive(),
  })
  .strict();

export type ProposalV1 = z.infer<typeof ProposalV1Schema>;

export const ApprovalDecisionV1Schema = z
  .object({
    proposalId: z.string().min(1),
    decision: z.enum(["approve", "reject"]),
    expectedVersion: z.number().int().positive(),
    scope: z.literal("single_delivery"),
    rationale: z.string().max(10_000).optional(),
    decidedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ApprovalDecisionV1 = z.infer<typeof ApprovalDecisionV1Schema>;

export const CreateProposalInputV1Schema = z
  .object({
    conversationId: z.string().min(1),
    kind: ProposalKindV1Schema,
    destination: z.string().min(1).max(128),
    risk: ProposalRiskV1Schema,
    preview: z.record(z.string(), z.unknown()),
    rationale: z.string().min(1).max(20_000),
    confidence: z.number().min(0).max(1),
    policySnapshot: z.record(z.string(), z.unknown()),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict();
export type CreateProposalInputV1 = z.infer<typeof CreateProposalInputV1Schema>;

export const CreateProposalResultV1Schema = z
  .object({ proposal: ProposalV1Schema, replayed: z.boolean() })
  .strict();
export type CreateProposalResultV1 = z.infer<
  typeof CreateProposalResultV1Schema
>;

export const ProposalListInputV1Schema = z
  .object({
    conversationId: z.string().min(1),
    status: ProposalStatusV1Schema.optional(),
    cursor: CursorV1Schema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ProposalListInputV1 = z.infer<typeof ProposalListInputV1Schema>;

export const ProposalListPageV1Schema = z
  .object({
    items: z.array(ProposalV1Schema),
    pageInfo: CursorPageInfoV1Schema,
  })
  .strict();
export type ProposalListPageV1 = z.infer<typeof ProposalListPageV1Schema>;

export const GetProposalInputV1Schema = z
  .object({ proposalId: z.string().min(1) })
  .strict();

export const ApprovalDecisionResultV1Schema = z
  .object({
    proposal: ProposalV1Schema,
    decisionId: z.string().min(1),
    outboxId: z.string().min(1).optional(),
    replayed: z.boolean(),
  })
  .strict();
export type ApprovalDecisionResultV1 = z.infer<
  typeof ApprovalDecisionResultV1Schema
>;
