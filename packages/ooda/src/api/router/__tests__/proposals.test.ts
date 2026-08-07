import { afterAll, describe, expect, it, vi } from "vitest";

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
});
