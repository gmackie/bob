import type {
  ApprovalDecisionV1,
  OodaRolloutCapabilityV1,
  OodaRolloutPolicyV1,
  ProposalV1,
} from "@gmacko/ooda-client/v1";

const PROPOSAL_CAPABILITY = {
  obsidian_note: "obsidian_delivery",
  research_job: "agent_jobs",
  bob_task: "durable_work_delivery",
  bob_project: "durable_work_delivery",
  bizpulse_venture: "portfolio_evidence",
  content_project: "specialist_delivery",
  fabrication_project: "specialist_delivery",
  hardware_validation: "specialist_delivery",
  mobile_release: "specialist_delivery",
} satisfies Record<ProposalV1["kind"], OodaRolloutCapabilityV1>;

const CAPABILITY_LABEL = {
  shadow_projection: "Shadow projection",
  conversation_read: "Conversation read",
  conversation_write: "Conversation write",
  mobile_text: "Mobile text",
  tts: "Voice playback",
  agent_jobs: "Agent jobs",
  obsidian_delivery: "Obsidian delivery",
  durable_work_delivery: "Durable work delivery",
  portfolio_evidence: "Portfolio evidence delivery",
  specialist_delivery: "Specialist delivery",
  reviews: "Reviews",
  push: "Push notifications",
} satisfies Record<OodaRolloutCapabilityV1, string>;

export function proposalCapability(
  kind: ProposalV1["kind"],
): OodaRolloutCapabilityV1 {
  return PROPOSAL_CAPABILITY[kind];
}

export function approvalAvailability(
  proposal: ProposalV1,
  rollout: OodaRolloutPolicyV1 | null,
  now = new Date(),
): { allowed: boolean; reason: string } {
  if (proposal.status !== "awaiting_approval") {
    return {
      allowed: false,
      reason: `This proposal is already ${proposal.status.replaceAll("_", " ")}.`,
    };
  }
  if (
    proposal.expiresAt &&
    new Date(proposal.expiresAt).getTime() <= now.getTime()
  ) {
    return {
      allowed: false,
      reason: "This proposal expired before approval.",
    };
  }
  if (!rollout) {
    return {
      allowed: false,
      reason: "Approval availability has not loaded yet.",
    };
  }
  if (rollout.killed) {
    return {
      allowed: false,
      reason: "The OODA rollout kill switch is active.",
    };
  }
  const capability = proposalCapability(proposal.kind);
  if (!rollout.capabilities[capability]) {
    return {
      allowed: false,
      reason: `${CAPABILITY_LABEL[capability]} is not enabled at this rollout stage.`,
    };
  }
  return { allowed: true, reason: "Ready for one approved delivery." };
}

export function buildProposalDecision(
  proposal: ProposalV1,
  decision: ApprovalDecisionV1["decision"],
  decidedAt = new Date().toISOString(),
): ApprovalDecisionV1 {
  return {
    proposalId: proposal.id,
    decision,
    expectedVersion: proposal.version,
    scope: "single_delivery",
    decidedAt,
  };
}
