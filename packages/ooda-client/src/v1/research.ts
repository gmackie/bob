import type {
  AgentJobV1,
  CreateAgentJobInputV1,
  SensitivityV1,
} from "@gmacko/ooda/contracts/v1";

export type ConversationResearchSourceV1 = {
  conversationId: string;
  eventId: string;
  role: "user" | "assistant";
  body: string;
  sensitivity: SensitivityV1;
  correlationId?: string;
  idempotencyKey: string;
};

export function canAutomaticallyResearchSensitivityV1(
  sensitivity: SensitivityV1,
): boolean {
  return sensitivity === "general" || sensitivity === "personal";
}

export function buildConversationResearchJobInputV1(
  source: ConversationResearchSourceV1,
): CreateAgentJobInputV1 {
  const excerpt = source.body.trim().slice(0, 50_000);
  if (!excerpt) throw new Error("Research excerpt is required");
  if (!canAutomaticallyResearchSensitivityV1(source.sensitivity)) {
    throw new Error("Sensitive research requires explicit disclosure approval");
  }
  return {
    conversationId: source.conversationId,
    sourceEventId: source.eventId,
    class: "read_only_research",
    prompt: [
      "Research the following durable OODA conversation excerpt. Return concise findings, uncertainty, and source links. Do not modify repositories or external systems.",
      `Source role: ${source.role}\nSource event: ${source.eventId}`,
      excerpt,
    ].join("\n\n"),
    ...(source.correlationId ? { correlationId: source.correlationId } : {}),
    idempotencyKey: source.idempotencyKey,
  };
}

export function agentJobResultPreviewV1(
  job: AgentJobV1,
  maxLength = 2_000,
): string | undefined {
  if (job.status !== "completed") return undefined;
  const findings = job.result?.response ?? job.result?.summary;
  if (!findings) return undefined;
  const normalized = findings.trim();
  if (!normalized) return undefined;
  const limit = Math.max(2, Math.min(maxLength, 20_000));
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1)}…`;
}
