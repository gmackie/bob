import { describe, expect, it } from "vitest";

import {
  ArchiveConversationInputV1Schema,
  AgentJobV1Schema,
  CancelAgentJobInputV1Schema,
  ClaimAgentJobInputV1Schema,
  ClaimAgentJobResultV1Schema,
  AppendConversationEventResultV1Schema,
  ApprovalDecisionV1Schema,
  ApprovalDecisionResultV1Schema,
  ContextItemV1Schema,
  ContextPackV1Schema,
  ConversationDetailV1Schema,
  ConversationEventV1Schema,
  ConversationListInputV1Schema,
  ConversationV1Schema,
  CreateTtsGrantInputV1Schema,
  CreateTtsGrantResultV1Schema,
  CreateConversationResultV1Schema,
  CreateHostTurnInputV1Schema,
  CreateHostTurnResultV1Schema,
  ClaimHostTurnResultV1Schema,
  CompleteHostTurnInputV1Schema,
  EnqueueHostTurnResultV1Schema,
  CreateAgentJobInputV1Schema,
  CreateAgentJobResultV1Schema,
  CreateOpportunityReviewInputV1Schema,
  CreateOpportunityReviewResultV1Schema,
  CreateProposalInputV1Schema,
  CreateProposalResultV1Schema,
  ClaimExternalStatusResultV1Schema,
  ClaimIntegrationDeliveryResultV1Schema,
  CompleteExternalStatusInputV1Schema,
  ExternalEvidenceV1Schema,
  IntegrationDeliveryV1Schema,
  RepairDeadLetterInputV1Schema,
  ExternalLinkV1Schema,
  ForkConversationInputV1Schema,
  HostProposalDraftV1Schema,
  MemorySeedV1Schema,
  MemorySearchInputV1Schema,
  MemorySearchPageV1Schema,
  SubmitMemoryFeedbackInputV1Schema,
  ProblemV1Schema,
  ProposalV1Schema,
  RecordAgentJobEventInputV1Schema,
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
      ConversationV1Schema.safeParse({ ...conversation, surprise: true })
        .success,
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
      ConversationEventV1Schema.safeParse({ ...event, sequence: "4.2" })
        .success,
    ).toBe(false);
    expect(
      ConversationEventV1Schema.safeParse({ ...event, type: "future_event" })
        .success,
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
    const create = {
      conversationId: "conversation-1",
      kind: "bob_project" as const,
      destination: "bob",
      risk: "durable_work" as const,
      preview: {
        name: "Voice inbox",
        acceptanceCriteria: ["Captures offline"],
      },
      rationale: "The idea has passed opportunity review.",
      confidence: 0.86,
      policySnapshot: { version: "policy-1" },
      idempotencyKey: "proposal-create-1",
    };
    expect(CreateProposalInputV1Schema.parse(create)).toEqual(create);
    expect(
      CreateProposalResultV1Schema.parse({ proposal, replayed: false }),
    ).toEqual({ proposal, replayed: false });
    expect(
      ApprovalDecisionResultV1Schema.safeParse({
        proposal: { ...proposal, status: "approved", version: 4 },
        decisionId: "decision-1",
        outboxId: "outbox-1",
        replayed: false,
      }).success,
    ).toBe(true);
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
      billingPolicy: "subscription_only",
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

  it("pins strict delivery, runner-claim, and repair contracts", () => {
    const delivery = {
      id: "outbox-1",
      proposalId: "proposal-1",
      destination: "bob",
      idempotencyKey: "delivery-1",
      status: "delivering",
      attemptCount: 1,
      availableAt: occurredAt,
      claimedAt: occurredAt,
      claimedBy: "runner-1",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    const proposal = {
      id: "proposal-1",
      conversationId: "conversation-1",
      kind: "bob_task",
      destination: "bob",
      status: "approved",
      risk: "durable_work",
      preview: { title: "Ship it", acceptanceCriteria: ["One task"] },
      rationale: "Approved by the user.",
      confidence: 0.9,
      policySnapshot: {},
      version: 2,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    expect(IntegrationDeliveryV1Schema.parse(delivery)).toEqual(delivery);
    expect(
      IntegrationDeliveryV1Schema.safeParse({ ...delivery, surprise: true })
        .success,
    ).toBe(false);
    expect(
      ClaimIntegrationDeliveryResultV1Schema.safeParse({ delivery, proposal })
        .success,
    ).toBe(true);
    expect(
      RepairDeadLetterInputV1Schema.safeParse({
        deadLetterId: "dead-letter-1",
        note: "Configuration repaired.",
        idempotencyKey: "repair-1",
        repairedAt: occurredAt,
      }).success,
    ).toBe(true);
  });

  it("pins leased external status reconciliation and immutable evidence", () => {
    const evidence = {
      id: "forgegraph_build:build-1",
      source: "forgegraph",
      kind: "build",
      externalId: "build-1",
      title: "ForgeGraph build",
      status: "passed",
      deepLink: "https://bob.example.com/work-items/task-1",
      occurredAt,
      metadata: { imageDigest: "sha256:abc" },
    };
    expect(ExternalEvidenceV1Schema.parse(evidence)).toEqual(evidence);
    expect(
      CompleteExternalStatusInputV1Schema.safeParse({
        externalLinkId: "link-1",
        runnerId: "runner-1",
        status: {
          status: "active",
          observedAt: occurredAt,
          metadata: {},
          evidence: [evidence],
        },
      }).success,
    ).toBe(true);
    expect(
      ClaimExternalStatusResultV1Schema.safeParse({
        link: {
          id: "link-1",
          conversationId: "conversation-1",
          destination: "bob",
          externalType: "work_item",
          externalId: "task-1",
          deepLink: "https://bob.example.com/work-items/task-1",
          idempotencyKey: "delivery-1",
          status: "active",
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      }).success,
    ).toBe(true);
  });

  it("defines cursor-paged memory search and explicit connection feedback", () => {
    const memory = MemorySeedV1Schema.parse({
      id: "memory-1",
      conversationId: "conversation-1",
      kind: "question",
      sourceEventId: "event-1",
      sourceSpan: { start: 0, end: 24 },
      normalizedText: "Could mushrooms regulate it?",
      entities: ["mushrooms"],
      sensitivity: "personal",
      confidence: 0.98,
      lifecycleState: "captured",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });

    expect(
      MemorySearchInputV1Schema.parse({ query: "mushrooms", limit: 20 }),
    ).toEqual({
      query: "mushrooms",
      includeSuperseded: false,
      limit: 20,
    });
    expect(
      MemorySearchPageV1Schema.safeParse({
        items: [memory],
        pageInfo: { hasMore: false },
      }).success,
    ).toBe(true);
    expect(
      SubmitMemoryFeedbackInputV1Schema.safeParse({
        edgeId: "edge-1",
        feedbackState: "suppressed",
        idempotencyKey: "device-feedback-1",
      }).success,
    ).toBe(true);
  });

  it("requires a complete constitutional opportunity review", () => {
    const input = {
      memorySeedId: "memory-1",
      dimensionScores: {
        expectedValue: 1,
        strategicFit: 0.9,
        evidence: 0.8,
        timing: 0.7,
        crossProjectSynergy: 0.9,
        energyInterestFit: 0.8,
        reversibilityLearningValue: 0.8,
        opportunityCost: 0.2,
      },
      uncertainty: 0.15,
      capacitySnapshot: {
        activeVentureExperiments: 1,
        majorImplementationStreams: 1,
      },
      opportunity: {
        problem: "Ideas disappear before they become useful work.",
        audience: "A single operator.",
        currentWorkaround: "Copy chat into task systems manually.",
        differentiation: "Keep provenance and require approval.",
        evidence: ["Existing tools are already used daily."],
        strategicFit: "Central to OODA.",
        smallestTest: "Deliver one project.",
        effort: "One stream.",
        risks: ["Unwanted work."],
        killCriteria: ["Duplicate durable objects."],
      },
      idempotencyKey: "opportunity-review-1",
    };
    const parsed = CreateOpportunityReviewInputV1Schema.parse(input);
    expect(parsed.capacitySnapshot.dailyRecommendedActions).toBe(0);
    expect(
      CreateOpportunityReviewInputV1Schema.safeParse({
        ...input,
        opportunity: { ...input.opportunity, killCriteria: [] },
      }).success,
    ).toBe(false);
    expect(
      CreateOpportunityReviewResultV1Schema.safeParse({
        replayed: false,
        review: {
          id: "review-1",
          memorySeedId: "memory-1",
          dimensionScores: parsed.dimensionScores,
          uncertainty: parsed.uncertainty,
          overallScore: 0.82,
          recommendation: "propose",
          capacitySnapshot: parsed.capacitySnapshot,
          opportunity: parsed.opportunity,
          createdAt: occurredAt,
        },
      }).success,
    ).toBe(true);
  });

  it("defines a bounded, resumable worker protocol without durable-write capabilities", () => {
    const create = {
      conversationId: "conversation-1",
      class: "scratch_prototype",
      prompt: "Prototype this only in disposable storage.",
      capabilities: ["scratch.write", "process.execute"],
      idempotencyKey: "device-job-1",
    };
    expect(CreateAgentJobInputV1Schema.parse(create)).toEqual(create);
    expect(
      CreateAgentJobInputV1Schema.safeParse({
        ...create,
        capabilities: ["bob.project.create"],
      }).success,
    ).toBe(true); // The server policy, not a brittle client enum, denies expansion.

    const job = AgentJobV1Schema.parse({
      id: "job-1",
      conversationId: "conversation-1",
      class: "scratch_prototype",
      status: "queued",
      provider: "codex",
      billingPolicy: "subscription_only",
      capabilities: ["process.execute", "scratch.write"],
      budget: { deadlineSeconds: 1_800, aggregateTokens: 250_000 },
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    expect(
      CreateAgentJobResultV1Schema.parse({ job, replayed: false }),
    ).toEqual({
      job,
      replayed: false,
    });
    expect(
      ClaimAgentJobInputV1Schema.safeParse({
        runnerId: "runner-1",
        providers: ["codex"],
        classes: ["scratch_prototype"],
      }).success,
    ).toBe(true);
    expect(
      ClaimAgentJobResultV1Schema.parse({
        job,
        prompt: create.prompt,
        attempt: 1,
        leaseToken: "11111111-1111-4111-8111-111111111111",
        contextItems: [],
      }),
    ).toEqual({
      job,
      prompt: create.prompt,
      attempt: 1,
      leaseToken: "11111111-1111-4111-8111-111111111111",
      contextItems: [],
    });
    expect(
      RecordAgentJobEventInputV1Schema.safeParse({
        jobId: "job-1",
        runnerId: "runner-1",
        leaseToken: "11111111-1111-4111-8111-111111111111",
        type: "progress",
        payload: { display: "Installing dependencies" },
        idempotencyKey: "runner-event-1",
        occurredAt,
      }).success,
    ).toBe(true);
    expect(
      CancelAgentJobInputV1Schema.safeParse({
        jobId: "job-1",
        idempotencyKey: "device-cancel-1",
      }).success,
    ).toBe(true);
  });

  it("distinguishes project-system context sources in disclosure receipts", () => {
    const base = {
      id: "context-item-1",
      sourceId: "source-record-1",
      sensitivity: "general" as const,
      decision: "disclosed" as const,
      reason: "Permitted read-only project context",
      content: "Project OODA has one in-progress task.",
    };

    for (const sourceType of [
      "bob_work_item",
      "kanbanger_issue",
      "bizpulse_venture",
      "forgegraph_changeset",
      "research_vault_source",
    ] as const) {
      expect(ContextItemV1Schema.parse({ ...base, sourceType })).toMatchObject({
        sourceType,
      });
    }
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
    expect(ProblemV1Schema.safeParse({ ...problem, status: 200 }).success).toBe(
      false,
    );
    expect(
      ProblemV1Schema.safeParse({ ...problem, debugStack: "secret" }).success,
    ).toBe(false);
  });

  it("requires TTS grants to reference canonical events instead of client text", () => {
    const input = {
      conversationId: "conversation-1",
      eventId: "event-1",
      requestMode: "manual",
      idempotencyKey: "device-tts-1",
    };
    const result = {
      grantId: "grant-1",
      streamUrl: "https://ooda.example/api/v1/tts-streams/opaque-token",
      expiresAt: occurredAt,
      replayed: false,
    };

    expect(CreateTtsGrantInputV1Schema.parse(input)).toEqual(input);
    expect(CreateTtsGrantResultV1Schema.parse(result)).toEqual(result);
    expect(
      CreateTtsGrantInputV1Schema.safeParse({
        ...input,
        text: "A client-selected secret",
      }).success,
    ).toBe(false);
  });

  it("binds host inference to one durable user event", () => {
    const input = {
      conversationId: "conversation-1",
      userEventId: "event-user-1",
      idempotencyKey: "device-host-1",
    };
    const assistantEvent = {
      id: "event-assistant-1",
      conversationId: "conversation-1",
      branchId: "branch-1",
      sequence: "2",
      type: "assistant_turn",
      actor: { type: "host", id: "claude" },
      payload: { display: "Full answer", speakable: "Short answer" },
      sensitivity: "personal",
      correlationId: "correlation-1",
      causationId: "event-user-1",
      occurredAt,
    };
    const result = {
      assistantEvent,
      provider: "claude",
      model: "claude-opus-4-6",
      providerResponseId: "provider-response-1",
      contextPackId: "context-pack-1",
      replayed: false,
      fallback: {
        preferredProvider: "grok",
        failures: [{ provider: "grok", code: "PROVIDER_FAILED" }],
      },
    };

    expect(CreateHostTurnInputV1Schema.parse(input)).toEqual(input);
    expect(CreateHostTurnResultV1Schema.parse(result)).toEqual(result);
  });

  it("defines a fenced subscription-host queue without provider credentials", () => {
    expect(
      EnqueueHostTurnResultV1Schema.safeParse({
        executionId: "execution-1",
        status: "queued",
        contextPackId: "context-1",
        replayed: false,
      }).success,
    ).toBe(true);
    expect(
      ClaimHostTurnResultV1Schema.safeParse({
        executionId: "execution-1",
        conversationId: "conversation-1",
        userEventId: "event-user-1",
        contextPackId: "context-1",
        preferredProvider: "grok",
        providerOrder: ["grok", "claude", "openai"],
        messages: [{ role: "user", content: "Hello" }],
        system: "Return display and speakable JSON.",
        sensitivity: "personal",
        correlationId: "correlation-1",
        attempt: 1,
        leaseToken: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(true);
    expect(
      CompleteHostTurnInputV1Schema.safeParse({
        executionId: "execution-1",
        runnerId: "runner-1",
        leaseToken: "11111111-1111-4111-8111-111111111111",
        provider: "openai",
        model: "codex-subscription-default",
        providerResponseId: "thread-1:turn-1",
        response: '{"display":"Hello","speakable":"Hello"}',
        runtimeSession: {
          provider: "openai",
          sessionId: "thread-1",
          turnId: "turn-1",
          transport: "app_server",
          authMode: "subscription",
        },
        failures: [],
        idempotencyKey: "complete-1",
        occurredAt,
      }).success,
    ).toBe(true);
  });

  it("accepts only bounded Bob task and project drafts from a host", () => {
    expect(
      HostProposalDraftV1Schema.safeParse({
        kind: "bob_task",
        title: "Add conversation-to-task drafting",
        description: "Create a private proposal card from explicit intent.",
        acceptanceCriteria: ["The user must approve before Bob receives it"],
        targetRepo: "/Volumes/dev/bob/bob",
        constraints: ["No host tools"],
        nonGoals: ["Automatic delivery"],
        rationale: "The user explicitly requested a task.",
        confidence: 0.95,
      }).success,
    ).toBe(true);
    expect(
      HostProposalDraftV1Schema.safeParse({
        kind: "bob_task",
        title: "Self-approved task",
        acceptanceCriteria: ["Model controls policy"],
        rationale: "Unsafe",
        confidence: 0.8,
        policySnapshot: { approved: true },
      }).success,
    ).toBe(false);
    expect(
      HostProposalDraftV1Schema.safeParse({
        kind: "mobile_release",
        name: "Unsupported direct mutation",
        acceptanceCriteria: ["Shipped"],
        rationale: "Out of scope",
        confidence: 0.8,
      }).success,
    ).toBe(false);
  });
});
