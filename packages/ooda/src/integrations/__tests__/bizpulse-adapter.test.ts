import { describe, expect, it } from "vitest";

import { ExternalReceiptV1Schema, type ProposalV1 } from "../../contracts/v1";
import {
  BizPulseDomainAdapter,
  type BizPulseStartup,
} from "../bizpulse-adapter";

const now = "2026-08-08T20:00:00.000Z";

function proposal(): ProposalV1 {
  return {
    id: "proposal-venture-1",
    conversationId: "conversation-1",
    kind: "bizpulse_venture",
    destination: "bizpulse",
    status: "approved",
    risk: "durable_work",
    preview: {
      name: "Conversation to Work",
      opportunityReviewId: "review-1",
      problem: "Ideas get lost before they become appropriately scoped work.",
      audience: "A single operator managing several technical ventures.",
      currentWorkaround: "Manually copy chat notes into project systems.",
      differentiation: "Preserve conversational provenance through execution.",
      evidence: ["The operator already uses OODA, Bob, and BizPulse."],
      strategicFit: "This is the central promise of OODA.",
      smallestTest: "Ship one approved conversation-to-project flow.",
      effort: "One focused implementation stream.",
      risks: ["Automation could create unwanted commitments."],
      killCriteria: ["The flow duplicates durable objects."],
    },
    rationale: "Promote the approved opportunity review.",
    confidence: 0.87,
    policySnapshot: { version: "proposal-policy-v1" },
    version: 2,
    createdAt: now,
    updatedAt: now,
  };
}

describe("BizPulseDomainAdapter", () => {
  it("creates one idea-stage venture and reconciles a replay by idempotency key", async () => {
    const startups: BizPulseStartup[] = [];
    const createInputs: Record<string, unknown>[] = [];
    const adapter = new BizPulseDomainAdapter({
      apiUrl: "https://bizpulse.example",
      client: {
        async listStartups() {
          return startups;
        },
        async getStartupBySlug(slug) {
          return startups.find((startup) => startup.slug === slug) ?? null;
        },
        async createStartup(input) {
          createInputs.push(input);
          const created: BizPulseStartup = {
            id: "venture-1",
            name: String(input.name),
            slug: String(input.slug),
            portfolioRole: String(input.portfolioRole),
            lifecycleStage: String(input.lifecycleStage),
            operatorNotes: String(input.operatorNotes),
            createdAt: now,
          };
          startups.push(created);
          return created;
        },
      },
    });

    const first = await adapter.commit(proposal(), "delivery-venture-1");
    const replay = await adapter.commit(proposal(), "delivery-venture-1");

    expect(createInputs).toHaveLength(1);
    expect(createInputs[0]).toMatchObject({
      name: "Conversation to Work",
      slug: "conversation-to-work",
      portfolioRole: "incubating",
      lifecycleStage: "idea",
      ownershipModel: "gmacko_owned",
      managingEntityName: "Gmacko LLC",
    });
    expect(createInputs[0]?.operatorNotes).toContain(
      "OODA_IDEMPOTENCY_KEY: delivery-venture-1",
    );
    expect(first).toMatchObject({
      destination: "bizpulse",
      externalType: "venture",
      externalId: "venture-1",
      idempotencyKey: "delivery-venture-1",
      status: "accepted",
    });
    expect(ExternalReceiptV1Schema.parse(first)).toEqual(first);
    expect(replay).toEqual(first);
  });

  it("reads venture status by the external BizPulse id", async () => {
    const existing: BizPulseStartup = {
      id: "venture-1",
      name: "Conversation to Work",
      slug: "conversation-to-work",
      portfolioRole: "incubating",
      lifecycleStage: "idea",
      createdAt: now,
    };
    const adapter = new BizPulseDomainAdapter({
      apiUrl: "https://bizpulse.example",
      client: {
        async listStartups() {
          return [existing];
        },
        async getStartupBySlug(slug) {
          return slug === existing.slug ? existing : null;
        },
        async createStartup() {
          throw new Error("must not write");
        },
      },
    });

    await expect(
      adapter.readStatus({
        id: "external-link-1",
        proposalId: "proposal-venture-1",
        destination: "bizpulse",
        externalType: "venture",
        externalId: "venture-1",
        deepLink: "https://bizpulse.example/dashboard/startup/venture-1",
        idempotencyKey: "delivery-venture-1",
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
    ).resolves.toMatchObject({
      status: "idea",
      metadata: { slug: "conversation-to-work" },
    });
  });

  it("rejects a preview slug that BizPulse cannot accept", async () => {
    const adapter = new BizPulseDomainAdapter({
      apiUrl: "https://bizpulse.example",
      client: {
        async listStartups() {
          return [];
        },
        async getStartupBySlug() {
          return null;
        },
        async createStartup() {
          throw new Error("must not write");
        },
      },
    });
    const malformed = proposal();
    malformed.preview.slug = "Not A Valid Slug";

    await expect(adapter.validateProposal(malformed)).resolves.toMatchObject({
      valid: false,
      errors: [expect.stringMatching(/slug/i)],
    });
  });
});
