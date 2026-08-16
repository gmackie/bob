import type { AgentJobV1 } from "@gmacko/ooda-client/v1";
import { describe, expect, it } from "vitest";

import {
  buildJobCancellation,
  jobCancellationAvailability,
  jobResultPresentation,
} from "./job-inspector-model";

function job(status: AgentJobV1["status"] = "running"): AgentJobV1 {
  return {
    id: "job-1",
    conversationId: "conversation-1",
    class: "read_only_research",
    status,
    provider: "codex",
    billingPolicy: "subscription_only",
    authMode: "subscription",
    capabilities: ["web.read"],
    budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
    createdAt: "2026-08-16T18:00:00.000Z",
    updatedAt: "2026-08-16T18:01:00.000Z",
    startedAt: "2026-08-16T18:01:00.000Z",
  };
}

describe("mobile agent-job inspector model", () => {
  it("allows the owner to cancel queued and running jobs", () => {
    expect(jobCancellationAvailability(job("queued"))).toEqual({
      allowed: true,
      reason: "Cancellation remains available during rollout rollback.",
    });
    expect(jobCancellationAvailability(job("running"))).toEqual({
      allowed: true,
      reason: "Cancellation remains available during rollout rollback.",
    });
  });

  it("does not offer duplicate cancellation or cancellation of terminal work", () => {
    expect(
      jobCancellationAvailability({
        ...job(),
        cancellationRequestedAt: "2026-08-16T18:02:00.000Z",
      }),
    ).toEqual({
      allowed: false,
      reason: "Cancellation is already requested.",
    });
    expect(jobCancellationAvailability(job("completed"))).toEqual({
      allowed: false,
      reason: "This job is already completed.",
    });
  });

  it("builds an idempotent cancellation command for the exact job", () => {
    expect(buildJobCancellation(job(), "cancel-device-1")).toEqual({
      jobId: "job-1",
      idempotencyKey: "cancel-device-1",
    });
  });

  it("presents completed research findings and promoted artifacts", () => {
    expect(
      jobResultPresentation({
        ...job("completed"),
        result: {
          response: "Start with the reversible prototype.",
          artifactRef: "scratch://job-1/report.md",
        },
      }),
    ).toEqual({
      response: "Start with the reversible prototype.",
      artifactRef: "scratch://job-1/report.md",
    });
    expect(jobResultPresentation(job("running"))).toBeNull();
  });
});
