import { describe, expect, it, vi } from "vitest";

import { OodaV1ClientError, createOodaV1Client } from "./client";

const conversation = {
  id: "conversation-1",
  ownerId: "user-1",
  title: "New thought",
  status: "active" as const,
  hostProvider: "grok",
  hostProfile: "daily",
  activeBranchId: "branch-1",
  lastSequence: "0",
  sensitivityCeiling: "personal" as const,
  ttsPolicy: "allowed" as const,
  createdAt: "2026-08-06T12:00:00.000Z",
  updatedAt: "2026-08-06T12:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OODA V1 client", () => {
  it("retrieves the account-scoped rollout receipt", async () => {
    const policy = {
      stage: "mobile_text" as const,
      eligible: true,
      killed: false,
      capabilities: {
        shadow_projection: true,
        conversation_read: true,
        conversation_write: true,
        mobile_text: true,
        tts: false,
        agent_jobs: false,
        obsidian_delivery: false,
        durable_work_delivery: false,
        portfolio_evidence: false,
        specialist_delivery: false,
        reviews: false,
        push: false,
      },
      reasons: [],
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(policy));
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: fetchFn,
    });

    await expect(client.rollout.status()).resolves.toEqual(policy);
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://ooda.example.test/api/v1/rollout",
    );
  });

  it("retrieves the production dogfood readiness ledger", async () => {
    const readiness = {
      generatedAt: "2026-08-23T12:00:00.000Z",
      dogfoodStartedAt: "2026-08-09T12:00:00.000Z",
      dogfoodElapsedDays: 14,
      acceptedTurnCount: 100,
      unresolvedTurnCount: 0,
      externalWriteCount: 3,
      gates: Array.from({ length: 10 }, (_, index) => ({
        id: [
          "dogfood_duration",
          "accepted_turn_durability",
          "duplicate_destinations",
          "sensitive_disclosure",
          "external_write_lineage",
          "unrepaired_dead_letters",
          "offline_reconciliation",
          "end_to_end_execution",
          "mobile_daily_driver",
          "legacy_retirement",
        ][index],
        status: "pass",
        observed: "proven",
        requirement: "required",
      })),
      ready: true,
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(readiness));
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: fetchFn,
    });

    await expect(client.rollout.readiness()).resolves.toEqual(readiness);
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://ooda.example.test/api/v1/readiness",
    );
  });

  it("lists conversations with cursor parameters and current auth headers", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        items: [conversation],
        pageInfo: { nextCursor: "next-page", hasMore: true },
      }),
    );
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test/",
      fetch: fetchFn,
      headers: async () => ({ Cookie: "better-auth.session=secret" }),
    });

    const result = await client.conversations.list({
      cursor: "current-page",
      limit: 25,
      status: "active",
      query: "voice",
    });

    expect(result.items).toEqual([conversation]);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://ooda.example.test/api/v1/conversations?cursor=current-page&limit=25&status=active&query=voice",
    );
    expect(init).toMatchObject({
      method: "GET",
      headers: expect.objectContaining({
        Accept: "application/json",
        Cookie: "better-auth.session=secret",
      }),
    });
  });

  it("appends an event without changing its device idempotency key", async () => {
    const event = {
      id: "event-1",
      conversationId: "conversation-1",
      branchId: "branch-1",
      sequence: "1",
      type: "user_turn" as const,
      actor: { type: "user" as const },
      payload: { display: "Capture this" },
      sensitivity: "personal" as const,
      correlationId: "correlation-1",
      idempotencyKey: "device-event-1",
      occurredAt: "2026-08-06T12:01:00.000Z",
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ event, replayed: false }));
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: fetchFn,
    });

    await client.events.append({
      conversationId: event.conversationId,
      branchId: event.branchId,
      type: event.type,
      actor: event.actor,
      payload: event.payload,
      sensitivity: event.sensitivity,
      correlationId: event.correlationId,
      idempotencyKey: event.idempotencyKey,
      occurredAt: event.occurredAt,
    });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("https://ooda.example.test/api/v1/events");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      idempotencyKey: "device-event-1",
      payload: { display: "Capture this" },
    });
  });

  it("throws one typed error for a versioned problem response", async () => {
    const problem = {
      version: "v1" as const,
      type: "https://ooda.example.test/problems/not-authenticated",
      title: "Authentication required",
      status: 401,
      code: "UNAUTHORIZED",
      detail: "Sign in again",
      correlationId: "correlation-problem",
    };
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(problem, 401)),
    });

    const error = await client.conversations
      .list()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OodaV1ClientError);
    expect(error).toMatchObject({ status: 401, code: "UNAUTHORIZED", problem });
  });

  it("builds a resumable authenticated stream request", async () => {
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test/",
      headers: () => ({ Authorization: "Bearer device-token" }),
    });

    const request = await client.events.streamRequest({
      conversationId: "conversation/id",
      afterSequence: "42",
    });

    expect(request.url).toBe(
      "https://ooda.example.test/api/v1/conversations/conversation%2Fid/events/stream?afterSequence=42",
    );
    expect(request.headers).toMatchObject({
      Accept: "text/event-stream",
      Authorization: "Bearer device-token",
      "Last-Event-ID": "42",
    });
  });

  it("creates an event-bound TTS grant and an authenticated audio source", async () => {
    const grant = {
      grantId: "grant-1",
      streamUrl:
        "https://ooda.example.test/api/v1/tts-streams/grant-1.signature",
      expiresAt: "2026-08-06T12:02:00.000Z",
      replayed: false,
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(grant, 201));
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: fetchFn,
      headers: () => ({ Authorization: "Bearer device-token" }),
    });

    await expect(
      client.voice.createGrant({
        conversationId: "conversation-1",
        eventId: "event-1",
        requestMode: "manual",
        idempotencyKey: "device-tts-1",
      }),
    ).resolves.toEqual(grant);
    await expect(client.voice.audioSource(grant.streamUrl)).resolves.toEqual({
      uri: grant.streamUrl,
      headers: {
        Accept: "audio/mpeg",
        Authorization: "Bearer device-token",
      },
    });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("https://ooda.example.test/api/v1/tts-grants");
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("text");
  });

  it("requests one host turn from a durable user event", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: fetchFn,
    });

    await client.host.createTurn({
      conversationId: "conversation-1",
      userEventId: "event-user-1",
      idempotencyKey: "device-event-1:host",
    });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe("https://ooda.example.test/api/v1/host-turns");
    expect(init).toMatchObject({ method: "POST" });
  });

  it("retrieves the exact disclosure receipt for a host turn", async () => {
    const pack = {
      id: "context-pack-1",
      conversationId: "conversation-1",
      provider: "grok",
      purpose: "host_turn" as const,
      policySnapshot: { version: "host-context-v1" },
      items: [
        {
          id: "context-item-1",
          sourceType: "kanbanger_issue" as const,
          sourceId: "OOD-7",
          sensitivity: "general" as const,
          decision: "disclosed" as const,
          reason: "Read-only project summary permitted for this host turn",
          content: "OOD-7 | in progress | Add context inspector",
        },
      ],
      createdAt: "2026-08-07T12:00:00.000Z",
    };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(pack));
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: fetchFn,
    });

    await expect(client.context.get(pack.id)).resolves.toEqual(pack);
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://ooda.example.test/api/v1/context-packs/context-pack-1",
    );
  });

  it("creates and retrieves an opportunity review through versioned resources", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ review: {}, replayed: false }))
      .mockResolvedValueOnce(jsonResponse({ id: "review/1" }));
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: fetchFn,
    });
    const input = {
      memorySeedId: "memory-1",
      dimensionScores: {
        expectedValue: 1,
        strategicFit: 1,
        evidence: 0.8,
        timing: 0.8,
        crossProjectSynergy: 0.9,
        energyInterestFit: 0.9,
        reversibilityLearningValue: 0.9,
        opportunityCost: 0.2,
      },
      uncertainty: 0.15,
      capacitySnapshot: {
        activeVentureExperiments: 1,
        majorImplementationStreams: 1,
        dailyRecommendedActions: 2,
      },
      opportunity: {
        problem: "Ideas get lost.",
        audience: "One operator.",
        currentWorkaround: "Manual copying.",
        differentiation: "Provenance and approval.",
        evidence: ["Existing daily workflow."],
        strategicFit: "Central to OODA.",
        smallestTest: "Deliver one project.",
        effort: "One stream.",
        risks: ["Unwanted work."],
        killCriteria: ["Duplicate durable objects."],
      },
      idempotencyKey: "opportunity-review-1",
    };

    await client.memories.createOpportunityReview(input);
    await client.memories.getOpportunityReview("review/1");

    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://ooda.example.test/api/v1/opportunity-reviews",
    );
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetchFn.mock.calls[0]![1]?.body))).toEqual(input);
    expect(String(fetchFn.mock.calls[1]![0])).toBe(
      "https://ooda.example.test/api/v1/opportunity-reviews/review%2F1",
    );
  });

  it("creates bounded jobs and approval-gated Bob proposals", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ job: {}, replayed: false }))
      .mockResolvedValueOnce(jsonResponse({ proposal: {}, replayed: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          proposal: {},
          decisionId: "decision-1",
          outboxId: "outbox-1",
          replayed: false,
        }),
      );
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: fetchFn,
    });

    await client.jobs.create({
      conversationId: "conversation-1",
      class: "read_only_research",
      prompt: "Research this without creating durable work.",
      idempotencyKey: "job-create-1",
    });
    await client.proposals.create({
      conversationId: "conversation-1",
      kind: "bob_task",
      destination: "bob",
      risk: "durable_work",
      preview: { title: "Ship it", acceptanceCriteria: ["Tests pass"] },
      rationale: "Ready for execution.",
      confidence: 0.9,
      policySnapshot: { version: "v1" },
      idempotencyKey: "proposal-create-1",
    });
    await client.proposals.decide({
      proposalId: "proposal-1",
      decision: "approve",
      expectedVersion: 1,
      scope: "single_delivery",
      decidedAt: "2026-08-07T16:00:00.000Z",
    });

    expect(fetchFn.mock.calls.map(([url]) => String(url))).toEqual([
      "https://ooda.example.test/api/v1/jobs",
      "https://ooda.example.test/api/v1/proposals",
      "https://ooda.example.test/api/v1/proposals/proposal-1/decisions",
    ]);
  });

  it("lists delivery state and submits a replay-safe dead-letter repair", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ items: [], pageInfo: { hasMore: false } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ deadLetter: {}, delivery: {}, replayed: false }),
      );
    const client = createOodaV1Client({
      baseUrl: "https://ooda.example.test",
      fetch: fetchFn,
    });

    await client.integrations.listDeliveries({
      conversationId: "conversation-1",
      status: "dead_letter",
      limit: 10,
    });
    await client.integrations.repairDeadLetter({
      deadLetterId: "dead-letter-1",
      note: "Bob configuration was corrected.",
      idempotencyKey: "repair-1",
      repairedAt: "2026-08-07T18:00:00.000Z",
    });

    expect(fetchFn.mock.calls.map(([url]) => String(url))).toEqual([
      "https://ooda.example.test/api/v1/integrations/deliveries?conversationId=conversation-1&status=dead_letter&limit=10",
      "https://ooda.example.test/api/v1/integrations/dead-letters/dead-letter-1/repair",
    ]);
  });
});
