import { z } from "zod";

export const OodaRolloutStageV1Schema = z.enum([
  "shadow",
  "conversations",
  "mobile_text",
  "tts",
  "jobs",
  "obsidian",
  "durable_work",
  "portfolio_evidence",
  "specialists",
  "reviews_push",
]);
export type OodaRolloutStageV1 = z.infer<typeof OodaRolloutStageV1Schema>;

export const OodaRolloutCapabilityV1Schema = z.enum([
  "shadow_projection",
  "conversation_read",
  "conversation_write",
  "mobile_text",
  "tts",
  "agent_jobs",
  "obsidian_delivery",
  "durable_work_delivery",
  "portfolio_evidence",
  "specialist_delivery",
  "reviews",
  "push",
]);
export type OodaRolloutCapabilityV1 = z.infer<
  typeof OodaRolloutCapabilityV1Schema
>;

export const OodaRolloutCapabilitiesV1Schema = z
  .object({
    shadow_projection: z.boolean(),
    conversation_read: z.boolean(),
    conversation_write: z.boolean(),
    mobile_text: z.boolean(),
    tts: z.boolean(),
    agent_jobs: z.boolean(),
    obsidian_delivery: z.boolean(),
    durable_work_delivery: z.boolean(),
    portfolio_evidence: z.boolean(),
    specialist_delivery: z.boolean(),
    reviews: z.boolean(),
    push: z.boolean(),
  })
  .strict();

export const OodaRolloutPolicyV1Schema = z
  .object({
    stage: OodaRolloutStageV1Schema,
    eligible: z.boolean(),
    killed: z.boolean(),
    capabilities: OodaRolloutCapabilitiesV1Schema,
    reasons: z.array(z.string().min(1).max(1_000)).max(20),
    dogfoodStartedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type OodaRolloutPolicyV1 = z.infer<typeof OodaRolloutPolicyV1Schema>;

export const ProductionReadinessGateIdV1Schema = z.enum([
  "dogfood_duration",
  "accepted_turn_durability",
  "duplicate_destinations",
  "sensitive_disclosure",
  "external_write_lineage",
  "unrepaired_dead_letters",
  "offline_reconciliation",
  "end_to_end_execution",
  "mobile_daily_driver",
  "legacy_retirement",
]);
export const ProductionReadinessGateV1Schema = z
  .object({
    id: ProductionReadinessGateIdV1Schema,
    status: z.enum(["pass", "fail", "pending"]),
    observed: z.string().min(1).max(2_000),
    requirement: z.string().min(1).max(2_000),
  })
  .strict();
export type ProductionReadinessGateV1 = z.infer<
  typeof ProductionReadinessGateV1Schema
>;

export const ProductionReadinessSnapshotV1Schema = z
  .object({
    generatedAt: z.iso.datetime({ offset: true }),
    dogfoodStartedAt: z.iso.datetime({ offset: true }).optional(),
    dogfoodElapsedDays: z.number().nonnegative(),
    acceptedTurnCount: z.number().int().nonnegative(),
    unresolvedTurnCount: z.number().int().nonnegative(),
    externalWriteCount: z.number().int().nonnegative(),
    gates: z.array(ProductionReadinessGateV1Schema).length(10),
    ready: z.boolean(),
  })
  .strict();
export type ProductionReadinessSnapshotV1 = z.infer<
  typeof ProductionReadinessSnapshotV1Schema
>;
