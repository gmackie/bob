import { z } from "zod";

import { SensitivityV1Schema } from "./conversation";

export const ContextPurposeV1Schema = z.enum([
  "host_turn",
  "agent_job",
  "tts",
  "proposal_validation",
  "integration_delivery",
]);

export const DisclosureDecisionV1Schema = z.enum([
  "disclosed",
  "redacted",
  "denied",
]);

export const ContextSourceTypeV1Schema = z.enum([
  "conversation_event",
  "memory_seed",
  "obsidian_note",
  "external_link",
  "user_instruction",
  "bob_work_item",
  "kanbanger_issue",
  "bizpulse_venture",
  "forgegraph_changeset",
  "research_vault_source",
]);

export const ContextItemV1Schema = z
  .object({
    id: z.string().min(1),
    sourceType: ContextSourceTypeV1Schema,
    sourceId: z.string().min(1),
    sensitivity: SensitivityV1Schema,
    decision: DisclosureDecisionV1Schema,
    reason: z.string().min(1).max(2_000),
    content: z.string().max(100_000).optional(),
    redaction: z.string().max(2_000).optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.decision === "disclosed" && item.content === undefined) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Disclosed context must include the exact disclosed content",
      });
    }
    if (item.decision === "denied" && item.content !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Denied context must not include source content",
      });
    }
  });

export type ContextItemV1 = z.infer<typeof ContextItemV1Schema>;
export type ContextSourceTypeV1 = z.infer<typeof ContextSourceTypeV1Schema>;

export const GetContextPackInputV1Schema = z
  .object({ id: z.string().min(1) })
  .strict();

export type GetContextPackInputV1 = z.infer<typeof GetContextPackInputV1Schema>;

export const ContextPackV1Schema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    provider: z.string().min(1).max(64),
    purpose: ContextPurposeV1Schema,
    policySnapshot: z.record(z.string(), z.unknown()),
    items: z.array(ContextItemV1Schema).max(1_000),
    createdAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export type ContextPackV1 = z.infer<typeof ContextPackV1Schema>;
