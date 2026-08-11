import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { AuthInstance } from "@gmacko/core/auth";

const DATABASE_URL_PLACEHOLDER =
  "postgres://localhost/ooda-proposals-router-test";
const { setPlaceholder, kernel } = vi.hoisted(() => {
  const setPlaceholder = !process.env.DATABASE_URL;
  process.env.DATABASE_URL ??=
    "postgres://localhost/ooda-proposals-router-test";
  return {
    setPlaceholder,
    kernel: {
      createProposal: vi.fn(),
      listProposals: vi.fn(),
      getProposal: vi.fn(),
      decideProposal: vi.fn(),
    },
  };
});

vi.mock("../../../kernel", () => kernel);

afterAll(() => {
  if (setPlaceholder && process.env.DATABASE_URL === DATABASE_URL_PLACEHOLDER) {
    delete process.env.DATABASE_URL;
  }
});

import { proposalsRouter } from "../proposals";
import { t } from "../../trpc";

const auth = {
  api: {
    getSession: vi.fn().mockResolvedValue({
      user: { id: "owner-proposals", email: "owner@example.test" },
      session: { id: "session-1" },
    }),
  },
} as unknown as AuthInstance;
const router = t.router({ proposals: proposalsRouter });
const createCaller = t.createCallerFactory(router);
const caller = () =>
  createCaller({ headers: new Headers(), auth, db: {} as never });

describe("proposals router", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("binds proposal creation and approval to the authenticated owner", async () => {
    const createInput = {
      conversationId: "conversation-1",
      kind: "bob_task" as const,
      destination: "bob",
      risk: "durable_work" as const,
      preview: {
        title: "Wire the inbox",
        acceptanceCriteria: ["Works offline"],
      },
      rationale: "Ready for durable execution.",
      confidence: 0.9,
      policySnapshot: { version: "v1" },
      idempotencyKey: "proposal-1",
    };
    const proposal = {
      id: "proposal-1",
      conversationId: createInput.conversationId,
      kind: createInput.kind,
      destination: createInput.destination,
      risk: createInput.risk,
      preview: createInput.preview,
      rationale: createInput.rationale,
      confidence: createInput.confidence,
      policySnapshot: createInput.policySnapshot,
      status: "awaiting_approval" as const,
      version: 1,
      createdAt: "2026-08-07T16:00:00.000Z",
      updatedAt: "2026-08-07T16:00:00.000Z",
    };
    kernel.createProposal.mockResolvedValue({
      proposal,
      replayed: false,
    });
    await caller().proposals.create(createInput);
    expect(kernel.createProposal).toHaveBeenCalledWith(
      {},
      "owner-proposals",
      createInput,
    );

    const decision = {
      proposalId: "proposal-1",
      decision: "approve" as const,
      expectedVersion: 1,
      scope: "single_delivery" as const,
      decidedAt: "2026-08-07T16:01:00.000Z",
    };
    kernel.getProposal.mockResolvedValue(proposal);
    kernel.decideProposal.mockResolvedValue({
      proposal: {
        ...proposal,
        status: "approved",
        version: 2,
      },
      decisionId: "decision-1",
      outboxId: "outbox-1",
      replayed: false,
    });
    await caller().proposals.decide(decision);
    expect(kernel.decideProposal).toHaveBeenCalledWith(
      {},
      "owner-proposals",
      decision,
    );
  });

  it("denies a new approval when the proposal destination is beyond the rollout stage", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OODA_ROLLOUT_STAGE", "jobs");
    vi.stubEnv("OODA_ROLLOUT_OWNER_IDS", "owner-proposals");
    kernel.getProposal.mockResolvedValue({
      id: "proposal-guarded",
      conversationId: "conversation-1",
      kind: "bob_project",
      destination: "bob",
      risk: "durable_work",
      preview: { name: "Guarded project" },
      rationale: "Wait for the durable-work rollout stage.",
      confidence: 0.9,
      policySnapshot: { version: "v1" },
      status: "awaiting_approval",
      version: 1,
      createdAt: "2026-08-11T18:00:00.000Z",
      updatedAt: "2026-08-11T18:00:00.000Z",
    });

    await expect(
      caller().proposals.decide({
        proposalId: "proposal-guarded",
        decision: "approve",
        expectedVersion: 1,
        scope: "single_delivery",
        decidedAt: "2026-08-11T18:01:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(kernel.decideProposal).not.toHaveBeenCalled();
  });

  it("keeps rejection available while the global rollout kill switch is active", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OODA_ROLLOUT_STAGE", "reviews_push");
    vi.stubEnv("OODA_ROLLOUT_OWNER_IDS", "owner-proposals");
    vi.stubEnv("OODA_ROLLOUT_KILL_SWITCH", "true");
    const decision = {
      proposalId: "proposal-rejected",
      decision: "reject" as const,
      expectedVersion: 1,
      scope: "single_delivery" as const,
      decidedAt: "2026-08-11T18:02:00.000Z",
    };
    kernel.decideProposal.mockResolvedValue({
      proposal: {
        id: decision.proposalId,
        conversationId: "conversation-1",
        kind: "bob_project",
        destination: "bob",
        risk: "durable_work",
        preview: { name: "Rejected project" },
        rationale: "Do not proceed.",
        confidence: 0.9,
        policySnapshot: { version: "v1" },
        status: "rejected",
        version: 2,
        createdAt: "2026-08-11T18:00:00.000Z",
        updatedAt: decision.decidedAt,
      },
      decisionId: "decision-rejected",
      replayed: false,
    });

    await expect(caller().proposals.decide(decision)).resolves.toMatchObject({
      proposal: { status: "rejected" },
    });
    expect(kernel.getProposal).not.toHaveBeenCalled();
    expect(kernel.decideProposal).toHaveBeenCalledWith(
      {},
      "owner-proposals",
      decision,
    );
  });

  it("keeps an already-recorded approval replayable after rollout rollback", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OODA_ROLLOUT_STAGE", "jobs");
    vi.stubEnv("OODA_ROLLOUT_OWNER_IDS", "owner-proposals");
    const decision = {
      proposalId: "proposal-approved",
      decision: "approve" as const,
      expectedVersion: 1,
      scope: "single_delivery" as const,
      decidedAt: "2026-08-11T18:03:00.000Z",
    };
    const approvedProposal = {
      id: decision.proposalId,
      conversationId: "conversation-1",
      kind: "bob_project" as const,
      destination: "bob",
      risk: "durable_work" as const,
      preview: {
        name: "Already approved",
        acceptanceCriteria: ["Idempotent replay remains available"],
      },
      rationale: "The immutable decision already exists.",
      confidence: 0.9,
      policySnapshot: { version: "v1" },
      status: "approved" as const,
      version: 2,
      createdAt: "2026-08-11T18:00:00.000Z",
      updatedAt: decision.decidedAt,
    };
    kernel.getProposal.mockResolvedValue(approvedProposal);
    kernel.decideProposal.mockResolvedValue({
      proposal: approvedProposal,
      decisionId: "decision-approved",
      outboxId: "outbox-approved",
      replayed: true,
    });

    await expect(caller().proposals.decide(decision)).resolves.toMatchObject({
      replayed: true,
      proposal: { status: "approved" },
    });
  });
});
