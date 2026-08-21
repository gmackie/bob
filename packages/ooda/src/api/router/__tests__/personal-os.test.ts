import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { AuthInstance } from "@gmacko/core/auth";

const DATABASE_URL_PLACEHOLDER =
  "postgres://localhost/ooda-personal-os-router-test";
const { setPlaceholder, kernel } = vi.hoisted(() => {
  const setPlaceholder = !process.env.DATABASE_URL;
  process.env.DATABASE_URL ??=
    "postgres://localhost/ooda-personal-os-router-test";
  return {
    setPlaceholder,
    kernel: {
      createConversation: vi.fn(),
      listConversations: vi.fn(),
      getConversationCompatible: vi.fn(),
      forkConversation: vi.fn(),
      archiveConversation: vi.fn(),
      appendConversationEvent: vi.fn(),
      correctConversationEvent: vi.fn(),
      listConversationEventsCompatible: vi.fn(),
      createConfiguredContextSources: vi.fn(() => []),
      createMemoryContextSource: vi.fn(() => ({
        id: "memory",
        inspect: vi.fn(),
      })),
      resolveContextSourceConfig: vi.fn(() => ({})),
      searchMemories: vi.fn(),
      createOpportunityReview: vi.fn(),
      getAttentionReview: vi.fn(),
      submitMemoryFeedback: vi.fn(),
      inspectMemory: vi.fn(),
      enqueueHostTurn: vi.fn(),
      claimHostTurn: vi.fn(),
      completeHostTurn: vi.fn(),
      failHostTurn: vi.fn(),
    },
  };
});

vi.mock("../../../kernel", () => kernel);

afterAll(() => {
  if (setPlaceholder && process.env.DATABASE_URL === DATABASE_URL_PLACEHOLDER) {
    delete process.env.DATABASE_URL;
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

import { conversationsRouter } from "../conversations";
import { eventsRouter } from "../events";
import { hermesRouter } from "../hermes";
import { hostRouter } from "../host";
import { memoriesRouter } from "../memories";
import { edgeRouter } from "../../edge-router";
import { handleOodaV1HttpRequest } from "../../openapi";
import { appRouter } from "../../root";
import { t } from "../../trpc";

const occurredAt = "2026-08-05T18:00:00.000Z";
const conversation = {
  id: "conversation-1",
  ownerId: "owner-a",
  title: "New thought",
  status: "active" as const,
  hostProvider: "grok",
  hostProfile: "daily",
  activeBranchId: "branch-1",
  lastSequence: "0",
  sensitivityCeiling: "personal" as const,
  ttsPolicy: "allowed" as const,
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
const event = {
  id: "event-1",
  conversationId: "conversation-1",
  branchId: "branch-1",
  sequence: "1",
  type: "user_turn" as const,
  actor: { type: "user" as const, id: "owner-a" },
  payload: { display: "Hello" },
  sensitivity: "general" as const,
  correlationId: "router-test",
  idempotencyKey: "append-1",
  occurredAt,
};
const opportunity = {
  problem: "Founders lose promising ideas between chat and validation.",
  audience: "Multi-project founders",
  currentWorkaround: "Scattered notes and manual portfolio reviews",
  differentiation: "Conversation-native evidence and capacity gates",
  evidence: ["Repeated personal workflow friction"],
  strategicFit: "Extends OODA and BizPulse",
  smallestTest: "Review five captured ideas for one week",
  effort: "One-week experiment",
  risks: ["Adds review overhead"],
  killCriteria: ["No promoted idea is revisited"],
};
const opportunityScores = {
  expectedValue: 0.9,
  strategicFit: 0.9,
  evidence: 0.8,
  timing: 0.8,
  crossProjectSynergy: 0.8,
  energyInterestFit: 0.9,
  reversibilityLearningValue: 0.9,
  opportunityCost: 0.2,
};
const capacitySnapshot = {
  activeVentureExperiments: 1,
  majorImplementationStreams: 1,
  dailyRecommendedActions: 0,
};

const router = t.router({
  conversations: conversationsRouter,
  events: eventsRouter,
  hermes: hermesRouter,
  host: hostRouter,
  memories: memoriesRouter,
});
const createCaller = t.createCallerFactory(router);
const auth = {
  api: {
    getSession: vi.fn().mockResolvedValue({
      user: { id: "owner-a", email: "owner@example.test" },
      session: { id: "session-1" },
    }),
  },
} as unknown as AuthInstance;

function caller() {
  return createCaller({ headers: new Headers(), auth, db: {} as never });
}

describe("personal OS routers", () => {
  it("mounts the same V1 conversation procedures in Node and edge routers", () => {
    const expected = [
      "conversations.archive",
      "conversations.create",
      "conversations.fork",
      "conversations.list",
      "conversations.retrieve",
      "context.get",
      "events.append",
      "events.correct",
      "events.paginate",
      "host.createTurn",
      "host.claim",
      "host.complete",
      "host.fail",
      "hermes.capture",
      "memories.createOpportunityReview",
      "memories.feedback",
      "memories.getOpportunityReview",
      "memories.inspect",
      "memories.search",
      "rollout.status",
      "rollout.readiness",
    ];
    const nodeProcedures = Object.keys(appRouter._def.procedures);
    const edgeProcedures = Object.keys(edgeRouter._def.procedures);
    expect(expected.every((name) => nodeProcedures.includes(name))).toBe(true);
    expect(expected.every((name) => edgeProcedures.includes(name))).toBe(true);
  });

  it("passes authenticated ownership into conversation commands", async () => {
    kernel.createConversation.mockResolvedValue({
      conversation,
      branch,
      replayed: false,
    });
    const input = {
      title: "New thought",
      idempotencyKey: "create-1",
      hostProvider: "grok",
      hostProfile: "daily",
      sensitivityCeiling: "personal" as const,
      ttsPolicy: "allowed" as const,
    };

    await expect(caller().conversations.create(input)).resolves.toEqual({
      conversation,
      branch,
      replayed: false,
    });
    expect(kernel.createConversation).toHaveBeenCalledWith(
      {},
      "owner-a",
      input,
    );
  });

  it("serves the same create contract through the versioned HTTP resource", async () => {
    kernel.createConversation.mockResolvedValue({
      conversation,
      branch,
      replayed: false,
    });
    const response = await handleOodaV1HttpRequest({
      request: new Request("https://ooda.test/api/v1/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "New thought",
          idempotencyKey: "create-http-1",
          hostProvider: "grok",
          hostProfile: "daily",
          sensitivityCeiling: "personal",
          ttsPolicy: "allowed",
        }),
      }),
      createContext: async () => ({
        headers: new Headers(),
        auth,
        db: {} as never,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conversation,
      branch,
      replayed: false,
    });
  });

  it("exposes paged event reads and append receipts", async () => {
    kernel.appendConversationEvent.mockResolvedValue({
      event,
      replayed: false,
    });
    kernel.listConversationEventsCompatible.mockResolvedValue({
      items: [event],
      pageInfo: { hasMore: false },
    });
    const appendInput = {
      conversationId: "conversation-1",
      branchId: "branch-1",
      type: "user_turn" as const,
      actor: { type: "user" as const, id: "owner-a" },
      payload: { display: "Hello" },
      sensitivity: "general" as const,
      correlationId: "router-test",
      idempotencyKey: "append-1",
      occurredAt,
    };

    await expect(caller().events.append(appendInput)).resolves.toEqual({
      event,
      replayed: false,
    });
    await expect(
      caller().events.paginate({
        conversationId: "conversation-1",
        limit: 100,
      }),
    ).resolves.toEqual({ items: [event], pageInfo: { hasMore: false } });
  });

  it("captures Hermes text as an owner-scoped replay-safe event", async () => {
    kernel.appendConversationEvent.mockResolvedValue({ event, replayed: true });

    await expect(
      caller().hermes.capture({
        schemaVersion: 1,
        requestId: "telegram:4512:9918",
        conversationId: "conversation-1",
        branchId: "branch-1",
        text: "Hello",
        occurredAt,
      }),
    ).resolves.toMatchObject({
      requestId: "telegram:4512:9918",
      replayed: true,
      canonicalRef: { kind: "conversation_event", id: "event-1" },
    });
    expect(kernel.appendConversationEvent).toHaveBeenCalledWith(
      {},
      "owner-a",
      expect.objectContaining({
        idempotencyKey: "telegram:4512:9918",
        actor: { type: "user" },
      }),
    );
  });

  it("adds relevant durable memory to queued host-turn context", async () => {
    const input = {
      conversationId: "conversation-1",
      userEventId: "event-1",
      idempotencyKey: "host-turn-1",
    };
    kernel.enqueueHostTurn.mockResolvedValue({
      executionId: "execution-1",
      status: "queued",
      contextPackId: "context-pack-1",
      replayed: false,
    });

    await caller().host.createTurn(input);

    expect(kernel.createMemoryContextSource).toHaveBeenCalledWith({
      search: expect.any(Function),
      excludeConversationId: "conversation-1",
    });
    expect(kernel.enqueueHostTurn).toHaveBeenCalledWith({}, "owner-a", input, {
      contextSources: [expect.objectContaining({ id: "memory" })],
      signal: expect.any(AbortSignal),
    });
  });

  it("treats opportunity review as a private conversation write", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OODA_ROLLOUT_STAGE", "shadow");
    vi.stubEnv("OODA_ROLLOUT_OWNER_IDS", "owner-a");
    kernel.createOpportunityReview.mockClear();
    kernel.createOpportunityReview.mockResolvedValue({
      review: {
        id: "review-1",
        memorySeedId: "memory-1",
        dimensionScores: opportunityScores,
        uncertainty: 0.2,
        overallScore: 0.81,
        recommendation: "propose",
        capacitySnapshot,
        opportunity,
        createdAt: occurredAt,
      },
      replayed: false,
    });
    const input = {
      memorySeedId: "memory-1",
      dimensionScores: opportunityScores,
      uncertainty: 0.2,
      capacitySnapshot,
      opportunity,
      idempotencyKey: "opportunity-review-1",
    };

    await expect(
      caller().memories.createOpportunityReview(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(kernel.createOpportunityReview).not.toHaveBeenCalled();

    vi.stubEnv("OODA_ROLLOUT_STAGE", "conversations");
    await expect(
      caller().memories.createOpportunityReview(input),
    ).resolves.toMatchObject({ review: { recommendation: "propose" } });
    expect(kernel.createOpportunityReview).toHaveBeenCalledWith(
      {},
      "owner-a",
      input,
    );
  });
});
