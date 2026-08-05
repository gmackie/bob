import { z } from "zod";

export const AgentJobClassV1Schema = z.enum([
  "read_only_research",
  "scratch_prototype",
  "comparison",
  "synthesis",
  "opportunity_review",
]);

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

export const AgentJobV1Schema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    class: AgentJobClassV1Schema,
    status: AgentJobStatusV1Schema,
    provider: z.string().min(1).max(64),
    capabilities: z.array(z.string().min(1).max(128)).max(100),
    budget: AgentJobBudgetV1Schema,
    contextPackId: z.string().min(1).optional(),
    correlationId: z.string().min(1).max(256).optional(),
    error: z.string().max(20_000).optional(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    startedAt: z.iso.datetime({ offset: true }).optional(),
    completedAt: z.iso.datetime({ offset: true }).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export type AgentJobV1 = z.infer<typeof AgentJobV1Schema>;

export const CreateAgentJobInputV1Schema = AgentJobV1Schema.pick({
  conversationId: true,
  class: true,
  provider: true,
  capabilities: true,
  budget: true,
  contextPackId: true,
  correlationId: true,
}).extend({
  prompt: z.string().min(1).max(100_000),
  idempotencyKey: z.string().min(1).max(256),
});

export type CreateAgentJobInputV1 = z.infer<
  typeof CreateAgentJobInputV1Schema
>;
