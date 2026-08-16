import type { AgentJobV1, CancelAgentJobInputV1 } from "@gmacko/ooda-client/v1";

export function jobResultPresentation(
  job: AgentJobV1,
): AgentJobV1["result"] | null {
  if (job.status !== "completed" || !job.result) return null;
  if (!job.result.response && !job.result.summary && !job.result.artifactRef)
    return null;
  return job.result;
}

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
