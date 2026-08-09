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
