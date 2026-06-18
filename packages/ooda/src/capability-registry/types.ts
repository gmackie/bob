import { z } from "zod";

export const CapabilityKindSchema = z.enum([
  "source_connector",
  "agent_adapter",
  "tool",
  "workspace_service",
]);

export const TrustLevelSchema = z.enum([
  "local",
  "reviewed",
  "community",
  "unreviewed",
]);

export const ExecutionScopeSchema = z.enum(["local_only", "remote_ok"]);

export const AccessModeSchema = z.enum(["read_only", "read_write"]);

export const CapabilityDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: CapabilityKindSchema,
  provider: z.string(),
  version: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  trustLevel: TrustLevelSchema,
  executionScope: ExecutionScopeSchema,
  defaultAccessMode: AccessModeSchema,
  authRequirements: z.array(z.string()),
  supportsProvenance: z.boolean(),
});

export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>;

export const ToolProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  capabilityIds: z.array(z.string()),
});

export type ToolProfile = z.infer<typeof ToolProfileSchema>;

export const SourceBundleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  connectorIds: z.array(z.string()),
});

export type SourceBundle = z.infer<typeof SourceBundleSchema>;
