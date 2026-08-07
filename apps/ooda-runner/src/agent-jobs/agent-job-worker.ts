import type { AgentAdapter } from "@gmacko/ooda/agent-adapters";
import type {
  AgentJobClassV1,
  AgentJobV1,
  ClaimAgentJobInputV1,
  ClaimAgentJobResultV1,
  RecordAgentJobEventInputV1,
} from "@gmacko/ooda/contracts/v1";

import { AgentJobExecutor } from "./agent-job-executor";
import { ScratchSandboxManager } from "./scratch-sandbox";

const JOB_CLASSES: AgentJobClassV1[] = [
  "read_only_research",
  "scratch_prototype",
  "comparison",
  "synthesis",
  "opportunity_review",
];

export type AgentJobWorkerApi = {
  claim(input: ClaimAgentJobInputV1): Promise<ClaimAgentJobResultV1>;
  recordEvent(input: RecordAgentJobEventInputV1): Promise<unknown>;
  control(input: { jobId: string; runnerId: string }): Promise<{
    status: AgentJobV1["status"];
    cancelRequested: boolean;
  }>;
};

export class AgentJobWorker {
  private readonly active = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private stopping = false;
  private readonly sandboxes: ScratchSandboxManager;
  private lastCleanupAt = 0;

  constructor(
    private readonly config: {
      runnerId: string;
      scratchRoot: string;
      adapters: Map<string, AgentAdapter>;
      api: AgentJobWorkerApi;
      maxConcurrent: number;
      controlPollMs?: number;
      environment?: Record<string, string | undefined>;
    },
  ) {
    this.sandboxes = new ScratchSandboxManager(config.scratchRoot);
  }

  async poll(): Promise<void> {
    if (this.stopping || this.active.size >= this.config.maxConcurrent) return;
    if (Date.now() - this.lastCleanupAt >= 60 * 60 * 1_000) {
      this.lastCleanupAt = Date.now();
      await this.sandboxes.cleanupExpired().catch(() => {});
    }
    const claim = await this.config.api.claim({
      runnerId: this.config.runnerId,
      providers: [...this.config.adapters.keys()].sort(),
      classes: JOB_CLASSES,
      leaseSeconds: 90,
    });
    if (!claim || !this.config.adapters.has(claim.job.provider)) return;

    const controller = new AbortController();
    const promise = this.execute(claim, controller).finally(() => {
      this.active.delete(claim.job.id);
    });
    this.active.set(claim.job.id, { controller, promise });
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.active.values()].map(({ promise }) => promise));
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const { controller } of this.active.values()) controller.abort();
    await this.waitForIdle();
  }

  private async execute(
    claim: NonNullable<ClaimAgentJobResultV1>,
    controller: AbortController,
  ): Promise<void> {
    const adapter = this.config.adapters.get(claim.job.provider)!;
    const executor = new AgentJobExecutor({
      adapter,
      sandboxes: this.sandboxes,
      environment: this.config.environment,
    });
    let eventIndex = 0;
    let writes = Promise.resolve();
    const record = (
      type: RecordAgentJobEventInputV1["type"],
      payload: Record<string, unknown>,
      occurredAt = new Date().toISOString(),
    ) => {
      eventIndex += 1;
      const input: RecordAgentJobEventInputV1 = {
        jobId: claim.job.id,
        runnerId: this.config.runnerId,
        type,
        payload,
        idempotencyKey: `${claim.job.id}:worker:${eventIndex}`,
        occurredAt,
      };
      const deliver = async () => {
        try {
          await this.config.api.recordEvent(input);
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
          await this.config.api.recordEvent(input);
        }
      };
      writes = writes.catch(() => undefined).then(deliver);
      return writes;
    };

    const controlTimer = setInterval(() => {
      void this.config.api
        .control({ jobId: claim.job.id, runnerId: this.config.runnerId })
        .then((control) => {
          if (control.cancelRequested || control.status !== "running") {
            controller.abort();
          }
        })
        .catch(() => {});
    }, this.config.controlPollMs ?? 1_000);
    controlTimer.unref?.();

    try {
      const result = await executor.execute({
        jobId: claim.job.id,
        class: claim.job.class,
        provider: claim.job.provider,
        prompt: claim.prompt,
        capabilities: claim.job.capabilities,
        budget: claim.job.budget,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "stdout" || event.type === "stderr") {
            void record(
              "progress",
              {
                stream: event.type,
                display: event.data.slice(0, 20_000),
              },
              event.timestamp,
            );
          } else if (
            event.type === "tool_call" ||
            event.type === "tool_result"
          ) {
            void record(
              event.type,
              { tool: event.tool ?? event.data },
              event.timestamp,
            );
          }
        },
      });
      await writes;
      if (result.exitCode === 0) {
        await record("completed", {
          result: {
            response: result.response,
            ...(result.artifactRef ? { artifactRef: result.artifactRef } : {}),
          },
        });
      } else {
        await record("failed", {
          error: `Agent exited with code ${result.exitCode}`,
        });
      }
    } catch (error) {
      await writes.catch(() => {});
      let cancelled = false;
      if (controller.signal.aborted) {
        cancelled = await this.config.api
          .control({ jobId: claim.job.id, runnerId: this.config.runnerId })
          .then((control) => control.cancelRequested)
          .catch(() => false);
      }
      await record(
        cancelled
          ? "cancelled"
          : controller.signal.aborted
            ? "timed_out"
            : "failed",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    } finally {
      clearInterval(controlTimer);
    }
  }
}
