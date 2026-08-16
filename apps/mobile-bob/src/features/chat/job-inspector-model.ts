import type { AgentJobV1, CancelAgentJobInputV1 } from "@gmacko/ooda-client/v1";

export function jobCancellationAvailability(job: AgentJobV1): {
  allowed: boolean;
  reason: string;
} {
  if (job.cancellationRequestedAt) {
    return {
      allowed: false,
      reason: "Cancellation is already requested.",
    };
  }
  if (job.status !== "queued" && job.status !== "running") {
    return {
      allowed: false,
      reason: `This job is already ${job.status.replaceAll("_", " ")}.`,
    };
  }
  return {
    allowed: true,
    reason: "Cancellation remains available during rollout rollback.",
  };
}

export function buildJobCancellation(
  job: AgentJobV1,
  idempotencyKey: string,
): CancelAgentJobInputV1 {
  return { jobId: job.id, idempotencyKey };
}
