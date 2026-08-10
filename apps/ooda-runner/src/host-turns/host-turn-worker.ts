import { dirname } from "node:path";

import type {
  AdapterEvent,
  AdapterProcessHandle,
  AgentAdapter,
  RuntimeSessionRef,
} from "@gmacko/ooda/agent-adapters";
import type {
  ClaimHostTurnInputV1,
  ClaimHostTurnResultV1,
  CompleteHostTurnInputV1,
  FailHostTurnInputV1,
  HostProviderV1,
} from "@gmacko/ooda/contracts/v1";

import { SubscriptionRuntimeBroker } from "../agent-jobs/subscription-runtime-broker";
import { ScratchSandboxManager } from "../agent-jobs/scratch-sandbox";
import { wrapInProcessSandbox } from "../agent-jobs/process-sandbox";
import {
  createSubscriptionCredentialHome,
  materializeCredentialCopies,
  type SubscriptionCredentialHome,
} from "../agent-jobs/subscription-credentials";
import { extractAgentResponse } from "../pty-output-parser";

type HostProvider = HostProviderV1;

export type HostTurnWorkerApi = {
  claim(input: ClaimHostTurnInputV1): Promise<ClaimHostTurnResultV1>;
  complete(input: CompleteHostTurnInputV1): Promise<unknown>;
  fail(input: FailHostTurnInputV1): Promise<unknown>;
};

function adapterId(provider: HostProvider): string {
  return provider === "openai" ? "codex" : provider;
}

function hostProvider(adapter: AgentAdapter): HostProvider | null {
  if (adapter.id === "grok" || adapter.id === "claude") return adapter.id;
  if (adapter.id === "codex") return "openai";
  return null;
}

function fullTranscript(
  messages: NonNullable<ClaimHostTurnResultV1>["messages"],
): string {
  return messages
    .map(
      (message) =>
        `${message.role === "user" ? "User" : "Assistant"}:\n${message.content}`,
    )
    .join("\n\n");
}

export class HostTurnWorker {
  private readonly active = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private readonly sandboxes: ScratchSandboxManager;
  private stopping = false;

  constructor(
    private readonly config: {
      runnerId: string;
      scratchRoot: string;
      adapters: Map<string, AgentAdapter>;
      api: HostTurnWorkerApi;
      maxConcurrent: number;
      deadlineSeconds?: number;
      environment?: Record<string, string | undefined>;
      models?: Partial<Record<HostProvider, string>>;
      processSandbox?: typeof wrapInProcessSandbox;
      createCredentialHome?: (
        parentPath: string,
      ) => Promise<SubscriptionCredentialHome>;
    },
  ) {
    this.sandboxes = new ScratchSandboxManager(config.scratchRoot);
  }

  async poll(): Promise<void> {
    if (this.stopping || this.active.size >= this.config.maxConcurrent) return;
    const providers = [...this.config.adapters.values()]
      .map(hostProvider)
      .filter((provider): provider is HostProvider => provider !== null)
      .sort(
        (left, right) =>
          (["grok", "claude", "openai"] as const).indexOf(left) -
          (["grok", "claude", "openai"] as const).indexOf(right),
      );
    if (!providers.length) return;
    const claim = await this.config.api.claim({
      runnerId: this.config.runnerId,
      providers,
      leaseSeconds: 300,
    });
    if (!claim) return;
    const controller = new AbortController();
    const promise = this.execute(claim, controller).finally(() => {
      this.active.delete(claim.executionId);
    });
    this.active.set(claim.executionId, { controller, promise });
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
    claim: NonNullable<ClaimHostTurnResultV1>,
    workerController: AbortController,
  ): Promise<void> {
    const failures: Array<{
      provider: HostProvider;
      code: "PROVIDER_UNAVAILABLE" | "PROVIDER_FAILED";
    }> = [];
    let lastError = "Every subscription host failed";

    for (const provider of claim.providerOrder) {
      const adapter = this.config.adapters.get(adapterId(provider));
      if (!adapter) {
        failures.push({ provider, code: "PROVIDER_UNAVAILABLE" });
        continue;
      }
      const sandbox = await this.sandboxes.create(
        `${claim.executionId}-${provider}-${claim.attempt}`,
      );
      const controller = new AbortController();
      const deadline = setTimeout(
        () => controller.abort(),
        (this.config.deadlineSeconds ?? 180) * 1_000,
      );
      deadline.unref?.();
      const abortAttempt = () => controller.abort();
      workerController.signal.addEventListener("abort", abortAttempt, {
        once: true,
      });
      if (workerController.signal.aborted) controller.abort();
      let handle: AdapterProcessHandle | undefined;
      let output = "";
      let runtimeSession: RuntimeSessionRef | undefined;
      let credentialHome: SubscriptionCredentialHome | undefined;
      let completion: CompleteHostTurnInputV1 | undefined;
      let credentialCleanupError: unknown;
      try {
        const createCredentialHome =
          this.config.createCredentialHome ?? createSubscriptionCredentialHome;
        credentialHome = await createCredentialHome(dirname(sandbox.path));
        const prepared = new SubscriptionRuntimeBroker().prepare({
          provider: adapter.id,
          jobClass: "synthesis",
          capabilities: [],
          billingPolicy: "subscription_only",
          authMode: "subscription",
          sandboxPath: sandbox.path,
          credentialHomePath: credentialHome.path,
          source: this.config.environment,
        });
        await materializeCredentialCopies(
          credentialHome.path,
          prepared.credentialCopies,
        );
        const resumable =
          claim.runtimeSession?.provider === provider
            ? claim.runtimeSession
            : undefined;
        const prompt = resumable
          ? claim.messages.at(-1)!.content
          : fullTranscript(claim.messages);
        const command = adapter.buildCommand({
          prompt,
          workspaceRoot: sandbox.path,
          systemPrompt: claim.system,
          model: this.config.models?.[provider],
          allowedTools: [],
          permissionMode: prepared.permissionMode,
          billingPolicy: "subscription_only",
          authMode: "subscription",
          session: resumable
            ? { mode: "resume", sessionId: resumable.sessionId }
            : { mode: "start" },
          correlationId: claim.correlationId,
        });
        const processSandbox =
          this.config.processSandbox ?? wrapInProcessSandbox;
        const containedCommand = await processSandbox(command, sandbox.path, {
          environment: prepared.environment,
          readOnlyPaths: prepared.credentialCopies.map(
            (copy) => copy.destinationPath,
          ),
          writablePaths: [credentialHome.path],
        });
        const result = await adapter.execute(
          containedCommand,
          (event: AdapterEvent) => {
            if (event.type === "stdout") output += event.data;
            if (event.type === "runtime_session" && event.runtimeSession)
              runtimeSession = event.runtimeSession;
            if (event.type === "permission_request" && event.permission) {
              const resolved =
                handle?.respondPermission?.(
                  event.permission.requestId,
                  "deny",
                  "Conversational host turns have no mutation capabilities",
                ) ?? false;
              if (!resolved) controller.abort();
            }
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
        runtimeSession = result.runtimeSession ?? runtimeSession;
        const response = extractAgentResponse(output);
        if (result.exitCode !== 0 || !response.trim()) {
          throw new Error(
            `Subscription host exited with code ${result.exitCode}`,
          );
        }
        completion = {
          executionId: claim.executionId,
          runnerId: this.config.runnerId,
          leaseToken: claim.leaseToken,
          provider,
          model:
            this.config.models?.[provider] ??
            `${provider}-subscription-default`,
          providerResponseId: runtimeSession
            ? `${runtimeSession.sessionId}:${runtimeSession.turnId ?? claim.attempt}`
            : `${claim.executionId}:${provider}:${claim.attempt}`,
          response,
          ...(runtimeSession
            ? {
                runtimeSession: {
                  provider,
                  sessionId: runtimeSession.sessionId,
                  ...(runtimeSession.turnId
                    ? { turnId: runtimeSession.turnId }
                    : {}),
                  transport: runtimeSession.transport,
                  authMode: "subscription" as const,
                },
              }
            : {}),
          failures,
          idempotencyKey: `${claim.executionId}:attempt:${claim.attempt}:complete`,
          occurredAt: new Date().toISOString(),
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        failures.push({ provider, code: "PROVIDER_FAILED" });
      } finally {
        clearTimeout(deadline);
        workerController.signal.removeEventListener("abort", abortAttempt);
        try {
          await credentialHome?.cleanup();
        } catch (error) {
          credentialCleanupError = error;
        }
        await sandbox.cleanup();
      }
      if (credentialCleanupError) {
        lastError =
          credentialCleanupError instanceof Error
            ? credentialCleanupError.message
            : String(credentialCleanupError);
        if (!failures.some((failure) => failure.provider === provider)) {
          failures.push({ provider, code: "PROVIDER_FAILED" });
        }
        break;
      }
      if (completion) {
        await this.config.api.complete(completion);
        return;
      }
      if (workerController.signal.aborted) break;
    }

    await this.config.api.fail({
      executionId: claim.executionId,
      runnerId: this.config.runnerId,
      leaseToken: claim.leaseToken,
      failures,
      error: lastError,
      idempotencyKey: `${claim.executionId}:attempt:${claim.attempt}:fail`,
      occurredAt: new Date().toISOString(),
    });
  }
}
