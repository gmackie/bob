import type {
  ConversationEventV1,
  SensitivityV1,
} from "@gmacko/ooda/contracts/v1";

export type ConversationTimelineKindV1 =
  | "message"
  | "tool"
  | "citation"
  | "proposal"
  | "job"
  | "evidence"
  | "system";

export type ConversationTimelineItemV1 = {
  id: string;
  eventId: string;
  sequence: string;
  kind: ConversationTimelineKindV1;
  body: string;
  occurredAt: string;
  sensitivity: SensitivityV1;
  role?: "user" | "assistant";
  title?: string;
  status?: string;
  href?: string;
  speakable?: string;
  contextPackId?: string;
  proposalId?: string;
  jobId?: string;
  corrected?: boolean;
  streaming?: boolean;
  tone?: "neutral" | "error";
};

function stringValue(
  payload: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function recordValue(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function deltaValue(payload: Record<string, unknown>): string | undefined {
  for (const key of ["delta", "content", "display", "text"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function eventBody(event: ConversationEventV1): string {
  return (
    stringValue(
      event.payload,
      "display",
      "content",
      "text",
      "summary",
      "detail",
      "message",
      "title",
      "delta",
    ) ?? event.type.replaceAll("_", " ")
  );
}

function latestCorrections(events: ConversationEventV1[]) {
  const corrections = new Map<
    string,
    { sequence: bigint; payload: Record<string, unknown> }
  >();
  for (const event of events) {
    if (event.type !== "correction") continue;
    const target = event.payload.correctedEventId;
    const replacement = event.payload.replacementPayload;
    if (
      typeof target !== "string" ||
      !replacement ||
      typeof replacement !== "object" ||
      Array.isArray(replacement)
    ) {
      continue;
    }
    const current = corrections.get(target);
    const sequence = BigInt(event.sequence);
    if (!current || sequence > current.sequence) {
      corrections.set(target, {
        sequence,
        payload: replacement as Record<string, unknown>,
      });
    }
  }
  return corrections;
}

function timelineItem(
  original: ConversationEventV1,
  payload: Record<string, unknown> = original.payload,
  options: { corrected?: boolean; streaming?: boolean } = {},
): ConversationTimelineItemV1 | null {
  const event = { ...original, payload };
  const receipt = recordValue(payload, "receipt");
  const base: ConversationTimelineItemV1 = {
    id: `event:${original.id}`,
    eventId: original.id,
    sequence: original.sequence,
    kind: "system",
    body: eventBody(event),
    occurredAt: original.occurredAt,
    sensitivity: original.sensitivity,
    ...(stringValue(payload, "status") || stringValue(receipt ?? {}, "status")
      ? {
          status:
            stringValue(payload, "status") ??
            stringValue(receipt ?? {}, "status"),
        }
      : {}),
    ...(stringValue(payload, "contextPackId")
      ? { contextPackId: stringValue(payload, "contextPackId") }
      : {}),
    ...(options.corrected ? { corrected: true } : {}),
    ...(options.streaming ? { streaming: true } : {}),
  };

  switch (event.type) {
    case "user_turn":
    case "assistant_turn":
    case "assistant_delta":
      return {
        ...base,
        kind: "message",
        role: event.type === "user_turn" ? "user" : "assistant",
        ...(stringValue(payload, "speakable")
          ? { speakable: stringValue(payload, "speakable") }
          : {}),
      };
    case "tool_call":
    case "tool_result":
      return {
        ...base,
        kind: "tool",
        title: stringValue(payload, "name", "toolName", "tool") ?? "Tool",
        body: stringValue(payload, "result", "summary", "output") ?? base.body,
      };
    case "citation":
      return {
        ...base,
        kind: "citation",
        title: stringValue(payload, "title") ?? "Source",
        ...(stringValue(payload, "url", "href")
          ? { href: stringValue(payload, "url", "href") }
          : {}),
      };
    case "proposal":
      return {
        ...base,
        kind: "proposal",
        title: stringValue(payload, "kind") ?? "Proposal",
        body: stringValue(payload, "rationale") ?? base.body,
        ...(stringValue(payload, "proposalId", "id")
          ? { proposalId: stringValue(payload, "proposalId", "id") }
          : {}),
      };
    case "agent_job_progress":
      return {
        ...base,
        kind: "job",
        title: stringValue(payload, "class", "kind") ?? "Agent job",
        ...(stringValue(payload, "jobId", "id")
          ? { jobId: stringValue(payload, "jobId", "id") }
          : {}),
      };
    case "external_evidence":
    case "delivery":
    case "attachment":
      return {
        ...base,
        kind: "evidence",
        title:
          stringValue(payload, "title") ??
          stringValue(receipt ?? {}, "destination", "externalType") ??
          "Evidence",
        ...(stringValue(payload, "url", "href", "deepLink") ||
        stringValue(receipt ?? {}, "deepLink")
          ? {
              href:
                stringValue(payload, "url", "href", "deepLink") ??
                stringValue(receipt ?? {}, "deepLink"),
            }
          : {}),
      };
    case "failure":
      return { ...base, kind: "system", tone: "error" };
    case "approval":
    case "voice_state":
    case "system_annotation":
      return { ...base, kind: "system", tone: "neutral" };
    case "correction":
      return null;
  }
}

export function buildConversationTimelineView(
  sourceEvents: ConversationEventV1[],
): ConversationTimelineItemV1[] {
  const events = [...sourceEvents].sort((left, right) => {
    const a = BigInt(left.sequence);
    const b = BigInt(right.sequence);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const corrections = latestCorrections(events);
  const completedCorrelations = new Set(
    events
      .filter((event) => event.type === "assistant_turn")
      .map((event) => event.correlationId),
  );
  const deltaGroups = new Map<string, ConversationEventV1[]>();
  for (const event of events) {
    if (
      event.type !== "assistant_delta" ||
      completedCorrelations.has(event.correlationId)
    ) {
      continue;
    }
    const group = deltaGroups.get(event.correlationId) ?? [];
    group.push(event);
    deltaGroups.set(event.correlationId, group);
  }
  const emittedDeltas = new Set<string>();
  const items: ConversationTimelineItemV1[] = [];

  for (const event of events) {
    if (event.type === "correction") continue;
    if (event.type === "assistant_delta") {
      if (
        completedCorrelations.has(event.correlationId) ||
        emittedDeltas.has(event.correlationId)
      ) {
        continue;
      }
      emittedDeltas.add(event.correlationId);
      const group = deltaGroups.get(event.correlationId) ?? [event];
      const display = group
        .map((delta) => deltaValue(delta.payload))
        .filter((value): value is string => Boolean(value))
        .join("");
      const item = timelineItem(
        event,
        { ...event.payload, display },
        { streaming: true },
      );
      if (item) items.push(item);
      continue;
    }
    const correction = corrections.get(event.id);
    const item = timelineItem(
      event,
      correction?.payload ?? event.payload,
      correction ? { corrected: true } : {},
    );
    if (item) items.push(item);
  }
  return items;
}
