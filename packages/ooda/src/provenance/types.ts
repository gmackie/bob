import { z } from "zod";

export const ProvenanceRecordSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  threadId: z.string(),
  sessionId: z.string(),
  capabilityId: z.string(),
  operationId: z.string(),
  sourceType: z.enum(["api", "web", "file", "agent", "user"]),
  queryOrInputRef: z.string(),
  canonicalSourceRef: z.string().optional(),
  retrievedAt: z.string(),
  unverified: z.boolean().optional(),
});

export type ProvenanceRecord = z.infer<typeof ProvenanceRecordSchema>;
