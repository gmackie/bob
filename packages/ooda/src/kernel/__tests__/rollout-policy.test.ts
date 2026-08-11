import { describe, expect, it } from "vitest";

import {
  assertOodaRolloutCapability,
  proposalKindRolloutCapability,
  resolveOodaRolloutPolicy,
} from "../rollout-policy";

describe("OODA production rollout policy", () => {
  it("fails closed in production when rollout configuration is absent", () => {
    const policy = resolveOodaRolloutPolicy("owner-1", {
      NODE_ENV: "production",
    });

    expect(policy.stage).toBe("shadow");
    expect(policy.eligible).toBe(false);
    expect(policy.capabilities.shadow_projection).toBe(true);
    expect(policy.capabilities.conversation_read).toBe(false);
  });

  it("enables only capabilities reached by the configured stage for an allowed owner", () => {
    const policy = resolveOodaRolloutPolicy("owner-1", {
      NODE_ENV: "production",
      OODA_ROLLOUT_STAGE: "tts",
      OODA_ROLLOUT_OWNER_IDS: "owner-1, owner-2",
      OODA_DOGFOOD_STARTED_AT: "2026-08-09T00:00:00.000Z",
    });

    expect(policy).toMatchObject({
      stage: "tts",
      eligible: true,
      dogfoodStartedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(policy.capabilities).toMatchObject({
      conversation_read: true,
      conversation_write: true,
      mobile_text: true,
      tts: true,
      agent_jobs: false,
      durable_work_delivery: false,
    });
  });

  it("denies non-allowlisted owners and honors the global kill switch", () => {
    const denied = resolveOodaRolloutPolicy("owner-2", {
      NODE_ENV: "production",
      OODA_ROLLOUT_STAGE: "reviews_push",
      OODA_ROLLOUT_OWNER_IDS: "owner-1",
    });
    const killed = resolveOodaRolloutPolicy("owner-1", {
      NODE_ENV: "production",
      OODA_ROLLOUT_STAGE: "reviews_push",
      OODA_ROLLOUT_OWNER_IDS: "owner-1",
      OODA_ROLLOUT_KILL_SWITCH: "true",
    });

    expect(denied.capabilities.conversation_read).toBe(false);
    expect(killed.killed).toBe(true);
    expect(killed.capabilities.shadow_projection).toBe(false);
  });

  it("provides a typed capability assertion for API gates", () => {
    const policy = resolveOodaRolloutPolicy("owner-1", {
      OODA_ROLLOUT_STAGE: "mobile_text",
      OODA_ROLLOUT_OWNER_IDS: "owner-1",
    });

    expect(() =>
      assertOodaRolloutCapability(policy, "mobile_text"),
    ).not.toThrow();
    expect(() => assertOodaRolloutCapability(policy, "tts")).toThrowError(
      /tts is not enabled/i,
    );
  });

  it("maps every proposal kind to the capability that authorizes its destination", () => {
    expect(proposalKindRolloutCapability("obsidian_note")).toBe(
      "obsidian_delivery",
    );
    expect(proposalKindRolloutCapability("research_job")).toBe("agent_jobs");
    expect(proposalKindRolloutCapability("bob_task")).toBe(
      "durable_work_delivery",
    );
    expect(proposalKindRolloutCapability("bob_project")).toBe(
      "durable_work_delivery",
    );
    expect(proposalKindRolloutCapability("bizpulse_venture")).toBe(
      "portfolio_evidence",
    );
    expect(proposalKindRolloutCapability("content_project")).toBe(
      "specialist_delivery",
    );
    expect(proposalKindRolloutCapability("fabrication_project")).toBe(
      "specialist_delivery",
    );
    expect(proposalKindRolloutCapability("hardware_validation")).toBe(
      "specialist_delivery",
    );
    expect(proposalKindRolloutCapability("mobile_release")).toBe(
      "specialist_delivery",
    );
  });
});
