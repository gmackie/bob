import { describe, expect, it } from "vitest";

import {
  ArchiveConversationInputV1Schema,
  AgentJobV1Schema,
  AppendConversationEventResultV1Schema,
  ApprovalDecisionV1Schema,
  ContextPackV1Schema,
  ConversationDetailV1Schema,
  ConversationEventV1Schema,
  ConversationListInputV1Schema,
  ConversationV1Schema,
  CreateConversationResultV1Schema,
  ExternalLinkV1Schema,
  ForkConversationInputV1Schema,
  MemorySeedV1Schema,
  ProblemV1Schema,
  ProposalV1Schema,
} from "../index";

const occurredAt = "2026-08-05T18:00:00.000Z";

describe("OODA V1 contracts", () => {
  it("accepts a complete conversation and rejects unknown fields", () => {
    const conversation = {
      id: "conversation-1",
      ownerId: "owner-1",
      title: "A new thought",
      status: "active",
      hostProvider: "grok",
      hostProfile: "daily",
      activeBranchId: "branch-1",
      lastSequence: "7",
      sensitivityCeiling: "sensitive",
      ttsPolicy: "allowed",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    expect(ConversationV1Schema.parse(conversation)).toEqual(conversation);
    expect(
      ConversationV1Schema.safeParse({ ...conversation, surprise: true }).success,
    ).toBe(false);
  });

  it("defines cursor-paged conversation commands and replay receipts", () => {
    const conversation = {
      id: "conversation-1",
      ownerId: "owner-1",
      title: "A new thought",
      status: "active",
      hostProvider: "grok",
      hostProfile: "daily",
      activeBranchId: "branch-1",
      lastSequence: "7",
      sensitivityCeiling: "personal",
      ttsPolicy: "allowed",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    const branch = {
      id: "branch-1",
      conversationId: "conversation-1",
      name: "main",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    expect(
      ConversationListInputV1Schema.parse({ limit: 25, status: "active" }),
    ).toEqual({ limit: 25, status: "active" });
    expect(
      CreateConversationResultV1Schema.parse({
        conversation,
        branch,
        replayed: false,
      }),
    ).toEqual({ conversation, branch, replayed: false });
    expect(
      ConversationDetailV1Schema.parse({ conversation, branches: [branch] }),
    ).toEqual({ conversation, branches: [branch] });
    expect(
      ForkConversationInputV1Schema.safeParse({
        conversationId: "conversation-1",
        parentBranchId: "branch-1",
        forkEventId: "event-1",
        name: "alternate",
        reason: "Explore a second path",
        idempotencyKey: "device-fork-1",
      }).success,
    ).toBe(true);
    expect(
      ArchiveConversationInputV1Schema.safeParse({
        conversationId: "conversation-1",
        idempotencyKey: "device-archive-1",
      }).success,
    ).toBe(true);
  });

  it("accepts a versioned conversation event and rejects malformed sequence values", () => {
    const event = {
      id: "event-1",
      conversationId: "conversation-1",
      branchId: "branch-1",
      sequence: "42",
      type: "user_turn",
      actor: { type: "user", id: "owner-1" },
      payload: { display: "Please remember this" },
      sensitivity: "personal",
      correlationId: "correlation-1",
      occurredAt,
    };

    expect(ConversationEventV1Schema.parse(event)).toEqual(event);
    expect(
      ConversationEventV1Schema.safeParse({ ...event, sequence: "4.2" }).success,
    ).toBe(false);
    expect(
      ConversationEventV1Schema.safeParse({ ...event, type: "future_event" }).success,
    ).toBe(false);
    expect(
      AppendConversationEventResultV1Schema.parse({ event, replayed: true }),
    ).toEqual({ event, replayed: true });
  });

  it("requires exact proposal and single-delivery approval shapes", () => {
    const proposal = {
      id: "proposal-1",
      conversationId: "conversation-1",
      kind: "bob_project",
      destination: "bob",
      status: "awaiting_approval",
      risk: "durable_work",
      preview: { name: "Voice inbox" },
      rationale: "The idea has passed opportunity review.",
      confidence: 0.86,
      policySnapshot: { version: "policy-1" },
      createdAt: occurredAt,
      updatedAt: occurredAt,
      version: 3,
    };
    const decision = {
      proposalId: "proposal-1",
      decision: "approve",
      expectedVersion: 3,
      scope: "single_delivery",
      decidedAt: occurredAt,
    };

    expect(ProposalV1Schema.parse(proposal)).toEqual(proposal);
    expect(ApprovalDecisionV1Schema.parse(decision)).toEqual(decision);
    expect(
      ApprovalDecisionV1Schema.safeParse({
        ...decision,
        scope: "all_future_deliveries",
      }).success,
    ).toBe(false);
    expect(
      ProposalV1Schema.safeParse({ ...proposal, confidence: 1.1 }).success,
    ).toBe(false);
  });

  it("validates disclosed context, memory, jobs, and external lineage", () => {
    const contextPack = {
      id: "context-1",
      conversationId: "conversation-1",
      provider: "grok",
      purpose: "host_turn",
      policySnapshot: { version: "policy-1" },
      items: [
        {
          id: "item-1",
          sourceType: "memory_seed",
          sourceId: "memory-1",
          sensitivity: "personal",
          decision: "disclosed",
          reason: "Relevant preference permitted for the host.",
          content: "Prefers short spoken summaries.",
        },
      ],
      createdAt: occurredAt,
    };
    const memory = {
      id: "memory-1",
      conversationId: "conversation-1",
      kind: "preference",
      sourceEventId: "event-1",
      sourceSpan: { start: 0, end: 14 },
      normalizedText: "Prefers short spoken summaries.",
      entities: ["speech"],
      sensitivity: "personal",
      confidence: 0.9,
      lifecycleState: "captured",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    const job = {
      id: "job-1",
      conversationId: "conversation-1",
      class: "read_only_research",
      status: "queued",
      provider: "claude",
      capabilities: ["web.read"],
      budget: { deadlineSeconds: 900, aggregateTokens: 150000 },
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    const link = {
      id: "link-1",
      proposalId: "proposal-1",
      destination: "bob",
      externalType: "project",
      externalId: "project-1",
      deepLink: "https://example.test/projects/project-1",
      idempotencyKey: "device-key-1",
      status: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    expect(ContextPackV1Schema.safeParse(contextPack).success).toBe(true);
    expect(MemorySeedV1Schema.safeParse(memory).success).toBe(true);
    expect(AgentJobV1Schema.safeParse(job).success).toBe(true);
    expect(ExternalLinkV1Schema.safeParse(link).success).toBe(true);
  });

  it("uses one strict versioned problem envelope", () => {
    const problem = {
      version: "v1",
      type: "https://ooda.example/problems/idempotency-conflict",
      title: "Idempotency conflict",
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      detail: "The key was already used for a different payload.",
      correlationId: "correlation-1",
    };

    expect(ProblemV1Schema.parse(problem)).toEqual(problem);
    expect(
      ProblemV1Schema.safeParse({ ...problem, status: 200 }).success,
    ).toBe(false);
    expect(
      ProblemV1Schema.safeParse({ ...problem, debugStack: "secret" }).success,
    ).toBe(false);
  });
});
