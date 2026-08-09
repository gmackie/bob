import { describe, expect, it, vi } from "vitest";

import type {
  ClaimExternalStatusResultV1,
  DomainAdapter,
  ExternalStatus,
} from "@gmacko/ooda/contracts/v1";

import { ExternalStatusWorker } from "../external-status-worker";

const claim: NonNullable<ClaimExternalStatusResultV1> = {
  link: {
    id: "link-1",
    conversationId: "conversation-1",
    destination: "bob",
    externalType: "work_item",
    externalId: "task-1",
    deepLink: "https://bob.example.com/work-items/task-1",
    idempotencyKey: "delivery-1",
    status: "active",
    createdAt: "2026-08-09T12:00:00.000Z",
    updatedAt: "2026-08-09T12:00:00.000Z",
  },
};

const status: ExternalStatus = {
  status: "active",
  observedAt: "2026-08-09T12:01:00.000Z",
  metadata: { workItemStatus: "in_progress" },
  evidence: [
    {
      id: "forgegraph_build:build-1",
      source: "forgegraph",
      kind: "build",
      externalId: "build-1",
      title: "ForgeGraph build",
      status: "passed",
      deepLink: "https://bob.example.com/work-items/task-1",
      occurredAt: "2026-08-09T12:00:30.000Z",
      metadata: {},
    },
  ],
};

function adapter(): DomainAdapter {
  return {
    inspect: vi.fn(),
    validateProposal: vi.fn(),
    commit: vi.fn(),
    lookupByIdempotencyKey: vi.fn(),
    readStatus: vi.fn().mockResolvedValue(status),
  };
}

describe("ExternalStatusWorker", () => {
  it("records execution evidence returned by the destination adapter", async () => {
    const bob = adapter();
    const api = {
      claimStatus: vi.fn().mockResolvedValue(claim),
      completeStatus: vi.fn().mockResolvedValue({}),
      failStatus: vi.fn().mockResolvedValue({}),
    };
    const worker = new ExternalStatusWorker({
      runnerId: "runner-1",
      adapters: new Map([["bob", bob]]),
      api,
    });

    await worker.poll();

    expect(bob.readStatus).toHaveBeenCalledWith(claim.link);
    expect(api.completeStatus).toHaveBeenCalledWith({
      externalLinkId: "link-1",
      runnerId: "runner-1",
      status,
    });
    expect(api.failStatus).not.toHaveBeenCalled();
  });

  it("releases a failed observation for a bounded retry", async () => {
    const bob = adapter();
    vi.mocked(bob.readStatus).mockRejectedValue(new Error("Bob unavailable"));
    const api = {
      claimStatus: vi.fn().mockResolvedValue(claim),
      completeStatus: vi.fn().mockResolvedValue({}),
      failStatus: vi.fn().mockResolvedValue({}),
    };
    const worker = new ExternalStatusWorker({
      runnerId: "runner-1",
      adapters: new Map([["bob", bob]]),
      api,
    });

    await worker.poll();

    expect(api.failStatus).toHaveBeenCalledWith({
      externalLinkId: "link-1",
      runnerId: "runner-1",
      error: "Bob unavailable",
      retrySeconds: 60,
    });
  });
});
