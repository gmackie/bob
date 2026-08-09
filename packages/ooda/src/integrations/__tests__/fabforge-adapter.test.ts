import { describe, expect, it, vi } from "vitest";

import { ExternalReceiptV1Schema, type ProposalV1 } from "../../contracts/v1";
import {
  FabForgeDomainAdapter,
  type FabForgeWorkOrder,
} from "../fabforge-adapter";

const now = "2026-08-09T13:00:00.000Z";

function proposal(): ProposalV1 {
  return {
    id: "proposal-fabrication-1",
    conversationId: "conversation-1",
    kind: "fabrication_project",
    destination: "fabforge",
    status: "approved",
    risk: "durable_work",
    preview: {
      title: "OODA handheld enclosure",
      description: "Candidate fabrication boundary for the approved prototype.",
      repositoryId: "gmackie/ooda-handheld",
      targetType: "manifest",
      targetRef: { path: "fabforge.project.json" },
      sourceFileRefs: ["fabforge.project.json", "cad/enclosure.step"],
      processTypes: ["three_d_print", "inspection"],
      groupingStrategy: "manifest",
      groupingKey: "ooda-handheld-enclosure",
      manifestPath: "fabforge.project.json",
    },
    rationale: "Open a candidate work order without starting physical work.",
    confidence: 0.9,
    policySnapshot: { version: "proposal-policy-v1" },
    version: 2,
    createdAt: now,
    updatedAt: now,
  };
}

describe("FabForgeDomainAdapter", () => {
  it("creates one candidate work order and reconciles by deterministic source key", async () => {
    const workOrders: FabForgeWorkOrder[] = [];
    const create = vi.fn(async (input) => {
      const created: FabForgeWorkOrder = {
        id: "work-order-1",
        workspaceId: input.workspaceId,
        title: input.title,
        status: "candidate",
        repositoryId: input.repositoryId,
        manualSourceKey: input.manualSourceKey,
        targetType: input.targetType,
        groupingKey: input.groupingKey,
        processTypes: input.processTypes,
        createdAt: now,
        updatedAt: now,
      };
      workOrders.push(created);
      return { created: true, workOrder: created };
    });
    const adapter = new FabForgeDomainAdapter({
      apiUrl: "https://fabforge.example",
      workspaceId: "workspace-1",
      client: {
        async listWorkOrders() {
          return workOrders;
        },
        createCandidateWorkOrder: create,
      },
    });

    const first = await adapter.commit(proposal(), "delivery-fabrication-1");
    const replay = await adapter.commit(proposal(), "delivery-fabrication-1");

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        status: "candidate",
        manualSourceKey: "ooda:delivery-fabrication-1",
        repositoryId: "gmackie/ooda-handheld",
        manifestPath: "fabforge.project.json",
        processTypes: ["three_d_print", "inspection"],
      }),
    );
    expect(first).toMatchObject({
      destination: "fabforge",
      externalType: "fabrication_work_order",
      externalId: "work-order-1",
      status: "accepted",
      idempotencyKey: "delivery-fabrication-1",
      metadata: { status: "candidate" },
    });
    expect(ExternalReceiptV1Schema.parse(first)).toEqual(first);
    expect(replay).toEqual(first);
  });

  it("rejects prepared actions and physical execution fields", async () => {
    const adapter = new FabForgeDomainAdapter({
      apiUrl: "https://fabforge.example",
      workspaceId: "workspace-1",
      client: {
        async listWorkOrders() {
          return [];
        },
        async createCandidateWorkOrder() {
          throw new Error("must not create");
        },
      },
    });
    const unsafe = proposal();
    unsafe.preview.preparedAction = { type: "queue_device" };
    unsafe.preview.startProduction = true;

    await expect(adapter.validateProposal(unsafe)).resolves.toMatchObject({
      valid: false,
      errors: [expect.stringMatching(/physical execution/i)],
    });
  });
});
