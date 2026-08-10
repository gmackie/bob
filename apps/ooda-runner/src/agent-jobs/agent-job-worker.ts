import type { AgentAdapter } from "@gmacko/ooda/agent-adapters";
import type {
  AgentJobClassV1,
  AgentJobV1,
  ClaimAgentJobInputV1,
  ClaimAgentJobResultV1,
  RecordAgentJobEventInputV1,
  ContextItemV1,
} from "@gmacko/ooda/contracts/v1";

import { AgentJobExecutor } from "./agent-job-executor";
import { wrapInProcessSandbox } from "./process-sandbox";
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
  control(input: {
    jobId: string;
    runnerId: string;
    leaseToken: string;
  }): Promise<{
    status: AgentJobV1["status"];
    cancelRequested: boolean;
    attempt: number;
  }>;
};

export function buildAgentJobPrompt(
  prompt: string,
  items: ContextItemV1[],
): string {
  const disclosed = items.filter(
    (item) =>
      item.decision !== "denied" &&
      typeof item.content === "string" &&
      item.content.length > 0,
  );
  if (!disclosed.length) return prompt;
  return [
    prompt,
    "",
    "<ooda_disclosed_context>",
    ...disclosed.map(
      (item) =>
        `[${item.sourceType}:${item.sourceId}; sensitivity=${item.sensitivity}; decision=${item.decision}]\n${item.content}`,
    ),
    "</ooda_disclosed_context>",
  ].join("\n");
}

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
      processSandbox?: typeof wrapInProcessSandbox;
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
      processSandbox: this.config.processSandbox,
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
        leaseToken: claim.leaseToken,
        type,
        payload,
        idempotencyKey: `${claim.job.id}:attempt:${claim.attempt}:event:${eventIndex}`,
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

    let consecutiveControlFailures = 0;
    const controlTimer = setInterval(() => {
      void this.config.api
        .control({
          jobId: claim.job.id,
          runnerId: this.config.runnerId,
          leaseToken: claim.leaseToken,
        })
        .then((control) => {
          consecutiveControlFailures = 0;
          if (
            control.cancelRequested ||
            control.status !== "running" ||
            control.attempt !== claim.attempt
          ) {
            controller.abort();
          }
        })
        .catch(() => {
          consecutiveControlFailures += 1;
          if (consecutiveControlFailures >= 3) controller.abort();
        });
    }, this.config.controlPollMs ?? 1_000);
    controlTimer.unref?.();

    try {
      const result = await executor.execute({
        jobId: claim.job.id,
        class: claim.job.class,
        provider: claim.job.provider,
        prompt: buildAgentJobPrompt(claim.prompt, claim.contextItems),
        billingPolicy: claim.job.billingPolicy,
        authMode: "subscription",
        session: claim.job.runtimeSession
          ? {
              mode: "resume",
              sessionId: claim.job.runtimeSession.sessionId,
            }
          : { mode: "start" },
        correlationId: claim.job.correlationId ?? claim.job.id,
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
          } else if (event.type === "runtime_session" && event.runtimeSession) {
            void record(
              "runtime_session",
              { runtimeSession: event.runtimeSession },
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
            ...(result.runtimeSession
              ? { runtimeSession: result.runtimeSession }
              : {}),
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
          .control({
            jobId: claim.job.id,
            runnerId: this.config.runnerId,
            leaseToken: claim.leaseToken,
          })
          .then((control) => control.cancelRequested)
          .catch(() => false);
      }
      try {
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
      } catch (recordError) {
        // A reclaimed lease deliberately fences the old runner from writing
        // its terminal event. Once control loss has aborted this execution,
        // that conflict is an expected stop condition—not a process-level
        // unhandled rejection. Non-aborted delivery failures still surface.
        if (!controller.signal.aborted) throw recordError;
      }
    } finally {
      clearInterval(controlTimer);
    }
  }
}
