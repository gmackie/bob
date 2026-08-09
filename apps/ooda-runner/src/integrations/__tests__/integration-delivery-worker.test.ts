import { describe, expect, it, vi } from "vitest";

import type {
  ClaimIntegrationDeliveryResultV1,
  DomainAdapter,
  ExternalReceiptV1,
  ProposalV1,
} from "@gmacko/ooda/contracts/v1";

import { IntegrationDeliveryWorker } from "../integration-delivery-worker";

const proposal: ProposalV1 = {
  id: "proposal-1",
  conversationId: "conversation-1",
  kind: "bob_task",
  destination: "bob",
  status: "approved",
  risk: "durable_work",
  preview: { title: "Ship it", acceptanceCriteria: ["One task"] },
  rationale: "Approved",
  confidence: 0.9,
  policySnapshot: {},
  version: 2,
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
};
const claim: NonNullable<ClaimIntegrationDeliveryResultV1> = {
  proposal,
  delivery: {
    id: "outbox-1",
    proposalId: proposal.id,
    destination: "bob",
    idempotencyKey: "delivery-1",
    status: "delivering",
    attemptCount: 1,
    availableAt: "2026-08-07T00:00:00.000Z",
    claimedAt: "2026-08-07T00:00:01.000Z",
    claimedBy: "runner-1",
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:01.000Z",
  },
};
const receipt: ExternalReceiptV1 = {
  destination: "bob",
  externalType: "work_item",
  externalId: "task-1",
  deepLink: "https://bob.example.com/work-items/task-1",
  idempotencyKey: "delivery-1",
  status: "accepted",
  metadata: {},
  recordedAt: "2026-08-07T00:00:02.000Z",
};

function adapter(overrides: Partial<DomainAdapter> = {}): DomainAdapter {
  return {
    inspect: vi.fn(),
    validateProposal: vi
      .fn()
      .mockResolvedValue({ valid: true, errors: [], checkedAt: "now" }),
    lookupByIdempotencyKey: vi.fn().mockResolvedValue(null),
    commit: vi.fn().mockResolvedValue(receipt),
    readStatus: vi.fn(),
    ...overrides,
  };
}

describe("IntegrationDeliveryWorker", () => {
  it("reconciles by idempotency key before committing", async () => {
    const bob = adapter({
      lookupByIdempotencyKey: vi.fn().mockResolvedValue(receipt),
    });
    const api = {
      claim: vi.fn().mockResolvedValue(claim),
      complete: vi.fn().mockResolvedValue({}),
      fail: vi.fn().mockResolvedValue({}),
    };
    const worker = new IntegrationDeliveryWorker({
      runnerId: "runner-1",
      adapters: new Map([["bob", bob]]),
      api,
    });

    await worker.poll();

    expect(bob.commit).not.toHaveBeenCalled();
    expect(api.complete).toHaveBeenCalledWith({
      outboxId: "outbox-1",
      runnerId: "runner-1",
      receipt,
    });
  });

  it("commits once when lookup proves the delivery is absent", async () => {
    const bob = adapter();
    const api = {
      claim: vi.fn().mockResolvedValue(claim),
      complete: vi.fn().mockResolvedValue({}),
      fail: vi.fn().mockResolvedValue({}),
    };
    const worker = new IntegrationDeliveryWorker({
      runnerId: "runner-1",
      adapters: new Map([["bob", bob]]),
      api,
    });

    await worker.poll();

    expect(bob.commit).toHaveBeenCalledWith(proposal, "delivery-1");
    expect(api.complete).toHaveBeenCalledOnce();
  });

  it("reconciles an ambiguous commit error before scheduling a retry", async () => {
    const bob = adapter({
      lookupByIdempotencyKey: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(receipt),
      commit: vi.fn().mockRejectedValue(new Error("socket closed")),
    });
    const api = {
      claim: vi.fn().mockResolvedValue(claim),
      complete: vi.fn().mockResolvedValue({}),
      fail: vi.fn().mockResolvedValue({}),
    };
    const worker = new IntegrationDeliveryWorker({
      runnerId: "runner-1",
      adapters: new Map([["bob", bob]]),
      api,
    });

    await worker.poll();

    expect(api.complete).toHaveBeenCalledOnce();
    expect(api.fail).not.toHaveBeenCalled();
  });

  it("dead-letters invalid destination proposals without calling commit", async () => {
    const bob = adapter({
      validateProposal: vi.fn().mockResolvedValue({
        valid: false,
        errors: ["Proposal is not approved"],
        checkedAt: "now",
      }),
    });
    const api = {
      claim: vi.fn().mockResolvedValue(claim),
      complete: vi.fn().mockResolvedValue({}),
      fail: vi.fn().mockResolvedValue({}),
    };
    const worker = new IntegrationDeliveryWorker({
      runnerId: "runner-1",
      adapters: new Map([["bob", bob]]),
      api,
    });

    await worker.poll();

    expect(bob.commit).not.toHaveBeenCalled();
    expect(api.fail).toHaveBeenCalledWith({
      outboxId: "outbox-1",
      runnerId: "runner-1",
      classification: "failed",
      error: "Proposal is not approved",
      retryable: false,
    });
  });
});
