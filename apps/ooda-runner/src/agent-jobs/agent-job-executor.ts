import type {
  AdapterEvent,
  AdapterProcessHandle,
  AgentAdapter,
} from "@gmacko/ooda/agent-adapters";
import type { AgentJobClassV1 } from "@gmacko/ooda/contracts/v1";

import { extractAgentResponse } from "../pty-output-parser";
import { type ScratchSandboxManager } from "./scratch-sandbox";
import { wrapInProcessSandbox } from "./process-sandbox";
import { SubscriptionRuntimeBroker } from "./subscription-runtime-broker";

export type ExecuteAgentJobInput = {
  jobId: string;
  class: AgentJobClassV1;
  provider: string;
  prompt: string;
  billingPolicy:
    | "subscription_only"
    | "subscription_preferred"
    | "metered_allowed";
  authMode: "subscription" | "api_key";
  session?: { mode: "start" | "resume"; sessionId?: string };
  correlationId?: string;
  capabilities: string[];
  budget: { deadlineSeconds: number; aggregateTokens: number };
  signal?: AbortSignal;
  onEvent: (event: AdapterEvent) => void;
};

export class AgentJobExecutor {
  constructor(
    private readonly config: {
      adapter: AgentAdapter;
      sandboxes: ScratchSandboxManager;
      environment?: Record<string, string | undefined>;
    },
  ) {}

  async execute(input: ExecuteAgentJobInput): Promise<{
    exitCode: number;
    response: string;
    artifactRef?: string;
    runtimeSession?: {
      provider: string;
      sessionId: string;
      turnId?: string;
      transport: "cli" | "app_server" | "acp";
      authMode: "subscription" | "api_key";
    };
  }> {
    const sandbox = await this.config.sandboxes.create(input.jobId);
    const controller = new AbortController();
    const externalAbort = () => controller.abort();
    input.signal?.addEventListener("abort", externalAbort, { once: true });
    if (input.signal?.aborted) controller.abort();
    const deadline = setTimeout(
      () => controller.abort(),
      input.budget.deadlineSeconds * 1_000,
    );
    deadline.unref?.();
    let handle: AdapterProcessHandle | undefined;
    let completed = false;
    let output = "";
    const abortProcess = () => handle?.kill();
    controller.signal.addEventListener("abort", abortProcess, { once: true });

    try {
      const prepared = new SubscriptionRuntimeBroker().prepare({
        provider: input.provider,
        jobClass: input.class,
        capabilities: input.capabilities,
        billingPolicy: input.billingPolicy,
        authMode: input.authMode,
        sandboxPath: sandbox.path,
        source: this.config.environment,
      });
      const requestedCommand = this.config.adapter.buildCommand({
        prompt: input.prompt,
        workspaceRoot: sandbox.path,
        systemPrompt: [
          "You are an OODA disposable worker.",
          `Job class: ${input.class}.`,
          `Granted capabilities: ${input.capabilities.join(", ") || "none"}.`,
          "Work only inside the supplied scratch directory.",
          "Do not create durable Bob, KanBanger, BizPulse, ForgeGraph, repository, publishing, messaging, purchase, credential, or deployment mutations.",
          "Return structured findings and identify uncertainty.",
        ].join("\n"),
        permissionMode: prepared.permissionMode,
        allowedTools: prepared.allowedTools,
        billingPolicy: input.billingPolicy,
        authMode: input.authMode,
        session: input.session,
        correlationId: input.correlationId,
      });
      const command = prepared.useOuterProcessSandbox
        ? await wrapInProcessSandbox(requestedCommand, sandbox.path)
        : requestedCommand;
      const result = await this.config.adapter.execute(
        command,
        (event) => {
          if (event.type === "stdout") output += event.data;
          if (event.type === "permission_request" && event.permission) {
            const resolved =
              handle?.respondPermission?.(
                event.permission.requestId,
                "deny",
                "Tool is outside this OODA job's declared capabilities",
              ) ?? false;
            // Headless jobs must never remain indefinitely paused at a tool
            // prompt. Declared Claude tools are pre-allowed; anything that
            // still asks is outside the bounded job grant and is denied. If
            // the adapter cannot accept the decision, abort the job visibly.
            if (!resolved) controller.abort();
          }
          input.onEvent(event);
        },
        {
          environment: prepared.environment,
          signal: controller.signal,
          onSpawn: (spawned) => {
            handle = spawned;
            if (controller.signal.aborted) spawned.kill();
          },
        },
      );
      if (controller.signal.aborted) {
        const error = new Error(
          "Agent job was cancelled or exceeded its deadline",
        );
        error.name = "AbortError";
        throw error;
      }
      completed = result.exitCode === 0;
      return {
        exitCode: result.exitCode,
        response: extractAgentResponse(output),
        ...(result.runtimeSession
          ? { runtimeSession: result.runtimeSession }
          : {}),
        ...(completed && input.class === "scratch_prototype"
          ? { artifactRef: sandbox.path }
          : {}),
      };
    } finally {
      clearTimeout(deadline);
      input.signal?.removeEventListener("abort", externalAbort);
      controller.signal.removeEventListener("abort", abortProcess);
      if (!completed || input.class !== "scratch_prototype")
        await sandbox.cleanup();
    }
  }
}
