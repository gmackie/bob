import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProposalV1 } from "../../contracts/v1";
import { BobDomainAdapter } from "../bob-adapter";

const projectProposal: ProposalV1 = {
  id: "proposal-project-1",
  conversationId: "conversation-1",
  kind: "bob_project",
  destination: "bob",
  status: "approved",
  risk: "durable_work",
  preview: {
    name: "Voice inbox",
    description: "Turn spoken thoughts into reviewable work.",
    acceptanceCriteria: [
      "Accepted turns are durable",
      "Delivery is replay-safe",
    ],
    targetRepo: "/Volumes/dev/bob/bob",
    tasks: ["Add intake", "Show receipt"],
  },
  rationale: "This is ready for durable execution.",
  confidence: 0.91,
  policySnapshot: { approval: "single_delivery" },
  version: 2,
  createdAt: "2026-08-07T12:00:00.000Z",
  updatedAt: "2026-08-07T12:01:00.000Z",
};

describe("BobDomainAdapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates the immutable approved proposal boundary", async () => {
    const adapter = new BobDomainAdapter({
      apiUrl: "https://bob.example.com",
      apiKey: "secret",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });

    await expect(
      adapter.validateProposal(projectProposal),
    ).resolves.toMatchObject({
      valid: true,
      errors: [],
    });
    await expect(
      adapter.validateProposal({
        ...projectProposal,
        status: "awaiting_approval",
      }),
    ).resolves.toMatchObject({
      valid: false,
      errors: ["Proposal is not approved"],
    });
  });

  it("commits a project through Bob with full lineage and destination idempotency", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: "project",
          id: "project-1",
          key: "VOICE",
          name: "Voice inbox",
          status: "active",
          replayed: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new BobDomainAdapter({
      apiUrl: "https://bob.example.com/",
      apiKey: "secret",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });

    const receipt = await adapter.commit(projectProposal, "delivery-key-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://bob.example.com/api/v1/projects",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
          "Idempotency-Key": "delivery-key-1",
        }),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      name: "Voice inbox",
      tasks: ["Add intake", "Show receipt"],
      idempotencyKey: "delivery-key-1",
      source: {
        system: "ooda",
        proposalId: "proposal-project-1",
        conversationId: "conversation-1",
      },
    });
    expect(receipt).toMatchObject({
      destination: "bob",
      externalType: "project",
      externalId: "project-1",
      deepLink: "https://bob.example.com/projects/project-1",
      idempotencyKey: "delivery-key-1",
      status: "accepted",
    });
  });

  it("looks up a committed task before replaying an ambiguous request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: "work_item",
          id: "task-1",
          title: "Wire delivery receipt",
          status: "backlog",
          replayed: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new BobDomainAdapter({
      apiUrl: "https://bob.example.com",
      apiKey: "secret",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });

    await expect(
      adapter.lookupByIdempotencyKey("delivery-key-2"),
    ).resolves.toMatchObject({
      externalType: "work_item",
      externalId: "task-1",
      deepLink: "https://bob.example.com/work-items/task-1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://bob.example.com/api/v1/intakes?idempotencyKey=delivery-key-2&workspaceId=11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns null when Bob has no destination receipt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    const adapter = new BobDomainAdapter({
      apiUrl: "https://bob.example.com",
      apiKey: "secret",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });

    await expect(adapter.lookupByIdempotencyKey("missing")).resolves.toBeNull();
  });
});
