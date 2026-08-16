import type {
  ConversationBranchV1,
  ConversationEventV1,
  SensitivityV1,
} from "@gmacko/ooda-client/v1";

import type { OodaOutboxItem, OodaOutboxStatus } from "./ooda-outbox";

export type OodaDeliveryState = OodaOutboxStatus | "synced" | "streaming";

interface TimelineBase {
  id: string;
  kind: "message" | "tool" | "citation" | "proposal" | "job" | "evidence" | "system";
  display: string;
  timestamp: string;
  sensitivity: SensitivityV1;
  contextPackId?: string;
  event?: ConversationEventV1;
}

export interface OodaMessageTimelineItem extends TimelineBase {
  kind: "message";
  role: "user" | "assistant";
  speakable?: string;
  deliveryState: OodaDeliveryState;
  corrected?: boolean;
  error?: string;
  outboxId?: string;
}

export interface OodaToolTimelineItem extends TimelineBase {
  kind: "tool";
  name: string;
  status?: string;
  result?: string;
}

export interface OodaCitationTimelineItem extends TimelineBase {
  kind: "citation";
  url?: string;
}

export interface OodaProposalTimelineItem extends TimelineBase {
  kind: "proposal";
  proposalId?: string;
  proposalKind?: string;
  status?: string;
  rationale?: string;
}

export interface OodaJobTimelineItem extends TimelineBase {
  kind: "job";
  jobId?: string;
  status?: string;
}

export interface OodaEvidenceTimelineItem extends TimelineBase {
  kind: "evidence";
  status?: string;
  url?: string;
}

export interface OodaSystemTimelineItem extends TimelineBase {
  kind: "system";
  tone: "neutral" | "error";
}

export type OodaTimelineItem =
  | OodaMessageTimelineItem
  | OodaToolTimelineItem
  | OodaCitationTimelineItem
  | OodaProposalTimelineItem
  | OodaJobTimelineItem
  | OodaEvidenceTimelineItem
  | OodaSystemTimelineItem;

export interface OodaTimelineProjectionOptions {
  branches: ConversationBranchV1[];
  targetBranchId: string;
}

function stringValue(payload: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function eventDisplay(event: ConversationEventV1): string {
  return stringValue(
    event.payload,
    "display",
    "content",
    "text",
    "summary",
    "detail",
    "message",
    "title",
  ) ?? event.type.replaceAll("_", " ");
}

function correctionsFor(events: ConversationEventV1[]) {
  const corrections = new Map<string, { sequence: bigint; payload: Record<string, unknown> }>();
  for (const event of events) {
    if (event.type !== "correction") continue;
    const correctedEventId = event.payload.correctedEventId;
    const replacementPayload = event.payload.replacementPayload;
    if (
      typeof correctedEventId !== "string" ||
      !replacementPayload ||
      typeof replacementPayload !== "object" ||
      Array.isArray(replacementPayload)
    ) continue;
    const current = corrections.get(correctedEventId);
    const sequence = BigInt(event.sequence);
    if (!current || sequence > current.sequence) {
      corrections.set(correctedEventId, {
        sequence,
        payload: replacementPayload as Record<string, unknown>,
      });
    }
  }
  return corrections;
}

function canonicalItem(
  original: ConversationEventV1,
  correction?: { payload: Record<string, unknown> },
): OodaTimelineItem | undefined {
  const event = correction
    ? { ...original, payload: correction.payload }
    : original;
  const contextPackId = stringValue(event.payload, "contextPackId");
  const base = {
    id: `event:${event.id}`,
    display: eventDisplay(event),
    timestamp: event.occurredAt,
    sensitivity: event.sensitivity,
    ...(contextPackId ? { contextPackId } : {}),
    event: original,
  };

  switch (event.type) {
    case "user_turn":
    case "assistant_turn":
    case "assistant_delta":
      return {
        ...base,
        kind: "message",
        role: event.type === "user_turn" ? "user" : "assistant",
        speakable: stringValue(event.payload, "speakable"),
        deliveryState: event.type === "assistant_delta" ? "streaming" : "synced",
        corrected: Boolean(correction),
      };
    case "tool_call":
    case "tool_result":
      return {
        ...base,
        kind: "tool",
        name: stringValue(event.payload, "name", "toolName", "tool") ?? "Tool",
        status: stringValue(event.payload, "status"),
        result: stringValue(event.payload, "result", "summary", "output"),
      };
    case "citation":
      return {
        ...base,
        kind: "citation",
        url: stringValue(event.payload, "url", "href"),
      };
    case "proposal":
      return {
        ...base,
        kind: "proposal",
        proposalId: stringValue(event.payload, "proposalId", "id"),
        proposalKind: stringValue(event.payload, "kind"),
        status: stringValue(event.payload, "status"),
        rationale: stringValue(event.payload, "rationale"),
      };
    case "agent_job_progress":
      return {
        ...base,
        kind: "job",
        jobId: stringValue(event.payload, "jobId", "id"),
        status: stringValue(event.payload, "status"),
      };
    case "external_evidence":
    case "delivery":
    case "attachment":
      return {
        ...base,
        kind: "evidence",
        status: stringValue(event.payload, "status"),
        url: stringValue(event.payload, "url", "href", "deepLink"),
      };
    case "failure":
      return { ...base, kind: "system", tone: "error" };
    case "voice_state":
    case "approval":
    case "system_annotation":
      return { ...base, kind: "system", tone: "neutral" };
    case "correction":
      return undefined;
  }
}

function pendingItem(item: OodaOutboxItem): OodaMessageTimelineItem {
  return {
    id: `pending:${item.id}`,
    kind: "message",
    role: "user",
    display: stringValue(item.input.payload, "display", "content", "text") ?? "Queued thought",
    timestamp: item.createdAt,
    sensitivity: item.input.sensitivity,
    deliveryState: item.status,
    error: item.error,
    outboxId: item.id,
  };
}

function projectBranchEvents(
  events: ConversationEventV1[],
  options?: OodaTimelineProjectionOptions,
): ConversationEventV1[] {
  if (!options) return events;
  const byId = new Map(options.branches.map((branch) => [branch.id, branch]));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const lineage: ConversationBranchV1[] = [];
  const visited = new Set<string>();
  let branch = byId.get(options.targetBranchId);
  while (branch && !visited.has(branch.id)) {
    visited.add(branch.id);
    lineage.push(branch);
    branch = branch.parentBranchId ? byId.get(branch.parentBranchId) : undefined;
  }
  if (!lineage.length) return events.filter((event) => event.branchId === options.targetBranchId);
  lineage.reverse();

  return lineage.flatMap((current, index) => {
    const child = lineage[index + 1];
    const forkEvent = child?.forkEventId ? eventById.get(child.forkEventId) : undefined;
    const cutoff = forkEvent ? BigInt(forkEvent.sequence) : undefined;
    return events.filter((event) =>
      event.branchId === current.id &&
      (cutoff === undefined || BigInt(event.sequence) <= cutoff),
    );
  });
}

export function buildOodaTimeline(
  sourceEvents: ConversationEventV1[],
  outbox: OodaOutboxItem[] = [],
  options?: OodaTimelineProjectionOptions,
): OodaTimelineItem[] {
  const events = projectBranchEvents([...sourceEvents], options).sort((left, right) => {
    const a = BigInt(left.sequence);
    const b = BigInt(right.sequence);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const corrections = correctionsFor(events);
  const canonicalIdempotencyKeys = new Set(
    events.flatMap((event) => event.idempotencyKey ? [event.idempotencyKey] : []),
  );
  const finalCorrelations = new Set(
    events.flatMap((event) => event.type === "assistant_turn" ? [event.correlationId] : []),
  );
  const deltaGroups = new Map<string, ConversationEventV1[]>();
  for (const event of events) {
    if (event.type !== "assistant_delta" || finalCorrelations.has(event.correlationId)) continue;
    const group = deltaGroups.get(event.correlationId) ?? [];
    group.push(event);
    deltaGroups.set(event.correlationId, group);
  }
  const emittedDeltaGroups = new Set<string>();
  const result: OodaTimelineItem[] = [];

  for (const event of events) {
    if (event.type === "assistant_delta") {
      if (finalCorrelations.has(event.correlationId) || emittedDeltaGroups.has(event.correlationId)) continue;
      emittedDeltaGroups.add(event.correlationId);
      const group = deltaGroups.get(event.correlationId) ?? [event];
      const aggregate = {
        ...event,
        payload: {
          ...event.payload,
          display: group.map((delta) => eventDisplay(delta)).join(""),
        },
      };
      const item = canonicalItem(aggregate);
      if (item) result.push(item);
      continue;
    }
    const item = canonicalItem(event, corrections.get(event.id));
    if (item) result.push(item);
  }

  const pending = options
    ? outbox.filter((item) => item.branchId === options.targetBranchId)
    : outbox;
  for (const item of [...pending].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (!canonicalIdempotencyKeys.has(item.idempotencyKey)) result.push(pendingItem(item));
  }

  return result;
}
