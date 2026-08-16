import { z } from "zod";

import { CursorPageInfoV1Schema, CursorV1Schema } from "./conversation";
import { ContextItemV1Schema } from "./context";

export const RuntimeBillingPolicyV1Schema = z.enum([
  "subscription_only",
  "subscription_preferred",
  "metered_allowed",
]);

export const RuntimeAuthModeV1Schema = z.enum(["subscription", "api_key"]);

export const AgentJobClassV1Schema = z.enum([
  "read_only_research",
  "scratch_prototype",
  "comparison",
  "synthesis",
  "opportunity_review",
]);
export type AgentJobClassV1 = z.infer<typeof AgentJobClassV1Schema>;

export const AgentJobStatusV1Schema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);

export const AgentJobBudgetV1Schema = z
  .object({
    deadlineSeconds: z.number().int().positive().max(86_400),
    aggregateTokens: z.number().int().positive().max(2_000_000),
  })
  .strict();

export const AgentJobResultV1Schema = z
  .object({
    response: z.string().max(200_000).optional(),
    summary: z.string().max(20_000).optional(),
    artifactRef: z.string().max(2_048).optional(),
  })
  .strict();
export type AgentJobResultV1 = z.infer<typeof AgentJobResultV1Schema>;

export const AgentJobV1Schema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    class: AgentJobClassV1Schema,
    status: AgentJobStatusV1Schema,
    provider: z.string().min(1).max(64),
    billingPolicy: RuntimeBillingPolicyV1Schema,
    authMode: RuntimeAuthModeV1Schema.optional(),
    runtimeSession: z
      .object({
        sessionId: z.string().min(1),
        turnId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    capabilities: z.array(z.string().min(1).max(128)).max(100),
    budget: AgentJobBudgetV1Schema,
    contextPackId: z.string().min(1).optional(),
    correlationId: z.string().min(1).max(256).optional(),
    result: AgentJobResultV1Schema.optional(),
    error: z.string().max(20_000).optional(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    startedAt: z.iso.datetime({ offset: true }).optional(),
    completedAt: z.iso.datetime({ offset: true }).optional(),
    cancellationRequestedAt: z.iso.datetime({ offset: true }).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export type AgentJobV1 = z.infer<typeof AgentJobV1Schema>;

export const CreateAgentJobInputV1Schema = z
  .object({
    conversationId: z.string().min(1),
    sourceEventId: z.string().min(1).optional(),
    class: AgentJobClassV1Schema,
    prompt: z.string().min(1).max(100_000),
    provider: z.string().min(1).max(64).optional(),
    billingPolicy: RuntimeBillingPolicyV1Schema.optional(),
    capabilities: z.array(z.string().min(1).max(128)).max(100).optional(),
    budget: AgentJobBudgetV1Schema.partial().optional(),
    contextPackId: z.string().min(1).optional(),
    correlationId: z.string().min(1).max(256).optional(),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict();

export type CreateAgentJobInputV1 = z.infer<typeof CreateAgentJobInputV1Schema>;

export const CreateAgentJobResultV1Schema = z
  .object({ job: AgentJobV1Schema, replayed: z.boolean() })
  .strict();
export type CreateAgentJobResultV1 = z.infer<
  typeof CreateAgentJobResultV1Schema
>;

export const AgentJobListInputV1Schema = z
  .object({
    conversationId: z.string().min(1),
    status: AgentJobStatusV1Schema.optional(),
    cursor: CursorV1Schema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type AgentJobListInputV1 = z.infer<typeof AgentJobListInputV1Schema>;

export const AgentJobListPageV1Schema = z
  .object({
    items: z.array(AgentJobV1Schema),
    pageInfo: CursorPageInfoV1Schema,
  })
  .strict();
export type AgentJobListPageV1 = z.infer<typeof AgentJobListPageV1Schema>;

export const GetAgentJobInputV1Schema = z
  .object({ jobId: z.string().min(1) })
  .strict();

export const CancelAgentJobInputV1Schema = z
  .object({
    jobId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict();
export type CancelAgentJobInputV1 = z.infer<typeof CancelAgentJobInputV1Schema>;

export const AgentJobMutationResultV1Schema = z
  .object({ job: AgentJobV1Schema, replayed: z.boolean() })
  .strict();
export type AgentJobMutationResultV1 = z.infer<
  typeof AgentJobMutationResultV1Schema
>;

export const ClaimAgentJobInputV1Schema = z
  .object({
    runnerId: z.string().min(1).max(256),
    providers: z.array(z.string().min(1).max(64)).min(1).max(20),
    classes: z.array(AgentJobClassV1Schema).min(1).max(5),
    leaseSeconds: z.number().int().min(30).max(300).default(90),
  })
  .strict();
export type ClaimAgentJobInputV1 = z.infer<typeof ClaimAgentJobInputV1Schema>;

export const ClaimAgentJobResultV1Schema = z
  .object({
    job: AgentJobV1Schema,
    prompt: z.string().min(1).max(100_000),
    attempt: z.number().int().positive(),
    leaseToken: z.string().uuid(),
    contextItems: z.array(ContextItemV1Schema).max(1_000),
  })
  .strict()
  .nullable();
export type ClaimAgentJobResultV1 = z.infer<typeof ClaimAgentJobResultV1Schema>;

export const AgentJobEventTypeV1Schema = z.enum([
  "queued",
  "claimed",
  "progress",
  "tool_call",
  "tool_result",
  "runtime_session",
  "artifact",
  "cancellation_requested",
  "cancelled",
  "completed",
  "failed",
  "timed_out",
]);

export const RecordAgentJobEventInputV1Schema = z
  .object({
    jobId: z.string().min(1),
    runnerId: z.string().min(1).max(256),
    leaseToken: z.string().uuid(),
    type: AgentJobEventTypeV1Schema.exclude([
      "queued",
      "claimed",
      "cancellation_requested",
    ]),
    payload: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().min(1).max(256),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type RecordAgentJobEventInputV1 = z.infer<
  typeof RecordAgentJobEventInputV1Schema
>;

export const AgentJobControlV1Schema = z
  .object({
    status: AgentJobStatusV1Schema,
    cancelRequested: z.boolean(),
    leaseExpiresAt: z.iso.datetime({ offset: true }).optional(),
    attempt: z.number().int().nonnegative(),
  })
  .strict();

export const GetAgentJobControlInputV1Schema = z
  .object({
    jobId: z.string().min(1),
    runnerId: z.string().min(1).max(256),
    leaseToken: z.string().uuid(),
  })
  .strict();
