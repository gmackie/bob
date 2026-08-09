import type {
  ConversationBranchV1,
  ConversationEventV1,
  ConversationV1,
} from "../contracts/v1";

type ConversationRow = {
  id: string;
  ownerId: string;
  title: string;
  status: "active" | "archived";
  hostProvider: string;
  hostProfile: string;
  activeBranchId: string | null;
  lastSequence: number | bigint;
  sensitivityCeiling: "general" | "personal" | "sensitive" | "restricted";
  ttsPolicy: "allowed" | "manual" | "disabled" | "sensitive_denied";
  createdAt: Date;
  updatedAt: Date;
};

type BranchRow = {
  id: string;
  conversationId: string;
  parentBranchId: string | null;
  forkEventId: string | null;
  name: string;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type EventRow = {
  id: string;
  conversationId: string;
  branchId: string;
  sequence: bigint | number;
  type: string;
  actorType: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  sensitivity: "general" | "personal" | "sensitive" | "restricted";
  correlationId: string;
  causationId: string | null;
  idempotencyKey: string | null;
  occurredAt: Date;
};

export function mapConversation(row: ConversationRow): ConversationV1 {
  if (!row.activeBranchId) throw new Error(`Conversation ${row.id} has no active branch`);
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    status: row.status,
    hostProvider: row.hostProvider,
    hostProfile: row.hostProfile,
    activeBranchId: row.activeBranchId,
    lastSequence: String(row.lastSequence),
    sensitivityCeiling: row.sensitivityCeiling,
    ttsPolicy: row.ttsPolicy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapBranch(row: BranchRow): ConversationBranchV1 {
  return {
    id: row.id,
    conversationId: row.conversationId,
    ...(row.parentBranchId ? { parentBranchId: row.parentBranchId } : {}),
    ...(row.forkEventId ? { forkEventId: row.forkEventId } : {}),
    name: row.name,
    ...(row.reason ? { reason: row.reason } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapEvent(row: EventRow): ConversationEventV1 {
  return {
    id: row.id,
    conversationId: row.conversationId,
    branchId: row.branchId,
    sequence: String(row.sequence),
    type: row.type as ConversationEventV1["type"],
    actor: {
      type: row.actorType as ConversationEventV1["actor"]["type"],
      ...(row.actorId ? { id: row.actorId } : {}),
    },
    payload: row.payload,
    sensitivity: row.sensitivity,
    correlationId: row.correlationId,
    ...(row.causationId ? { causationId: row.causationId } : {}),
    ...(row.idempotencyKey ? { idempotencyKey: row.idempotencyKey } : {}),
    occurredAt: row.occurredAt.toISOString(),
  };
}
