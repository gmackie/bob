import type { OodaRolloutPolicyV1, ProposalV1 } from "@gmacko/ooda-client/v1";
import { describe, expect, it } from "vitest";

import {
  approvalAvailability,
  buildProposalDecision,
  proposalCapability,
} from "./proposal-inspector-model";

function proposal(
  kind: ProposalV1["kind"] = "bob_project",
  status: ProposalV1["status"] = "awaiting_approval",
): ProposalV1 {
  return {
    id: "proposal-1",
    conversationId: "conversation-1",
    kind,
    destination: "bob",
    status,
    risk: "durable_work",
    preview: { title: "Build the thing" },
    rationale: "The user asked to promote this thought.",
    confidence: 0.91,
    policySnapshot: {},
    createdAt: "2026-08-16T18:00:00.000Z",
    updatedAt: "2026-08-16T18:00:00.000Z",
    version: 3,
  };
}

function rollout(
  enabled: Partial<OodaRolloutPolicyV1["capabilities"]> = {},
): OodaRolloutPolicyV1 {
  return {
    stage: "durable_work",
    eligible: true,
    killed: false,
    reasons: [],
    capabilities: {
      shadow_projection: true,
      conversation_read: true,
      conversation_write: true,
      mobile_text: true,
      tts: true,
      agent_jobs: true,
      obsidian_delivery: true,
      durable_work_delivery: true,
      portfolio_evidence: false,
      specialist_delivery: false,
      reviews: false,
      push: false,
      ...enabled,
    },
  };
}

describe("mobile proposal inspector model", () => {
  it("maps each proposal kind to the server rollout capability", () => {
    expect(proposalCapability("obsidian_note")).toBe("obsidian_delivery");
    expect(proposalCapability("research_job")).toBe("agent_jobs");
    expect(proposalCapability("bob_task")).toBe("durable_work_delivery");
    expect(proposalCapability("bob_project")).toBe("durable_work_delivery");
    expect(proposalCapability("bizpulse_venture")).toBe("portfolio_evidence");
    expect(proposalCapability("content_project")).toBe("specialist_delivery");
    expect(proposalCapability("fabrication_project")).toBe(
      "specialist_delivery",
    );
    expect(proposalCapability("hardware_validation")).toBe(
      "specialist_delivery",
    );
    expect(proposalCapability("mobile_release")).toBe("specialist_delivery");
  });

  it("allows only awaiting proposals whose exact destination capability is live", () => {
    expect(approvalAvailability(proposal(), rollout())).toEqual({
      allowed: true,
      reason: "Ready for one approved delivery.",
    });
    expect(
      approvalAvailability(
        proposal("bizpulse_venture"),
        rollout({ portfolio_evidence: false }),
      ),
    ).toEqual({
      allowed: false,
      reason:
        "Portfolio evidence delivery is not enabled at this rollout stage.",
    });
    expect(
      approvalAvailability(proposal("bob_project", "delivered"), rollout()),
    ).toEqual({
      allowed: false,
      reason: "This proposal is already delivered.",
    });
  });

  it("keeps rejection available during a kill while denying new approval", () => {
    const killed = { ...rollout(), killed: true };
    expect(approvalAvailability(proposal(), killed)).toEqual({
      allowed: false,
      reason: "The OODA rollout kill switch is active.",
    });
    expect(
      buildProposalDecision(proposal(), "reject", "2026-08-16T18:30:00.000Z"),
    ).toEqual({
      proposalId: "proposal-1",
      decision: "reject",
      expectedVersion: 3,
      scope: "single_delivery",
      decidedAt: "2026-08-16T18:30:00.000Z",
    });
  });

  it("does not offer approval after the proposal expires", () => {
    const expired = {
      ...proposal(),
      expiresAt: "2026-08-16T18:15:00.000Z",
    };
    expect(
      approvalAvailability(
        expired,
        rollout(),
        new Date("2026-08-16T18:15:01.000Z"),
      ),
    ).toEqual({
      allowed: false,
      reason: "This proposal expired before approval.",
    });
  });
});
