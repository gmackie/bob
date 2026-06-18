import { randomUUID } from "node:crypto";

import type { ProvenanceRecord } from "./types";

export interface ProvenanceInput {
  artifactId: string;
  threadId: string;
  sessionId: string;
  capabilityId: string;
  operationId: string;
  sourceType: "api" | "web" | "file" | "agent" | "user";
  queryOrInputRef: string;
  canonicalSourceRef?: string;
  unverified?: boolean;
}

export function createProvenanceRecord(
  input: ProvenanceInput,
): ProvenanceRecord {
  return {
    id: randomUUID(),
    artifactId: input.artifactId,
    threadId: input.threadId,
    sessionId: input.sessionId,
    capabilityId: input.capabilityId,
    operationId: input.operationId,
    sourceType: input.sourceType,
    queryOrInputRef: input.queryOrInputRef,
    canonicalSourceRef: input.canonicalSourceRef,
    retrievedAt: new Date().toISOString(),
    unverified: input.unverified,
  };
}
