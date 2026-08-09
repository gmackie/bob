import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import type {
  AdapterCommand,
  AdapterEvent,
  AgentAdapter,
  BuildCommandOptions,
  ExecuteOptions,
} from "@gmacko/ooda/agent-adapters";

import { AgentJobWorker, buildAgentJobPrompt } from "../agent-job-worker";

class SuccessfulAdapter implements AgentAdapter {
  id = "codex";
  name = "Successful adapter";
  transport = "stdio" as const;
  isAvailable() {
    return true;
  }
  buildCommand(opts: BuildCommandOptions): AdapterCommand {
    return { binary: "mock", args: [], cwd: opts.workspaceRoot };
  }
  async execute(
    _command: AdapterCommand,
    onEvent: (event: AdapterEvent) => void,
  ) {
    onEvent({
      type: "stdout",
      data: "A concise research result",
      timestamp: "2026-08-07T15:00:00.000Z",
    });
    return { exitCode: 0 };
  }
}

class LeaseLostAdapter implements AgentAdapter {
  id = "codex";
  name = "Lease-lost adapter";
  transport = "stdio" as const;
  isAvailable() {
    return true;
  }
  buildCommand(opts: BuildCommandOptions): AdapterCommand {
    return { binary: "mock", args: [], cwd: opts.workspaceRoot };
  }
  execute(
    _command: AdapterCommand,
    _onEvent: (event: AdapterEvent) => void,
    options?: ExecuteOptions,
  ): Promise<{ exitCode: number }> {
    return new Promise((resolve) => {
      options?.onSpawn?.({
        write: () => false,
        kill: () => resolve({ exitCode: 143 }),
      });
    });
  }
}

describe("AgentJobWorker", () => {
  it("passes only disclosed or redacted context to the provider prompt", () => {
    const prompt = buildAgentJobPrompt("Compare the options", [
      {
        id: "context-1",
        sourceType: "bob_work_item",
        sourceId: "task-1",
        sensitivity: "general",
        decision: "disclosed",
        reason: "permitted",
        content: "Task one is blocked by the migration.",
      },
      {
        id: "context-2",
        sourceType: "bizpulse_venture",
        sourceId: "venture-1",
        sensitivity: "sensitive",
        decision: "denied",
        reason: "category permission required",
        content: "PRIVATE VENTURE MATERIAL",
      },
      {
        id: "context-3",
        sourceType: "forgegraph_changeset",
        sourceId: "change-1",
        sensitivity: "personal",
        decision: "redacted",
        reason: "credential removed",
        content: "Build passed with [REDACTED CREDENTIAL].",
        redaction: "credential",
      },
    ]);

    expect(prompt).toContain("Task one is blocked by the migration.");
    expect(prompt).toContain("Build passed with [REDACTED CREDENTIAL].");
    expect(prompt).not.toContain("PRIVATE VENTURE MATERIAL");
    expect(prompt).toContain("<ooda_disclosed_context>");
  });

  it("executes the disposable lane and records findings without a Bob run", async () => {
    const claim = vi.fn().mockResolvedValueOnce({
      job: {
        id: "job-worker-1",
        conversationId: "conversation-1",
        class: "read_only_research",
        status: "running",
        provider: "codex",
        billingPolicy: "subscription_only",
        capabilities: ["web.read"],
        budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
        createdAt: "2026-08-07T15:00:00.000Z",
        updatedAt: "2026-08-07T15:00:00.000Z",
      },
      prompt: "Research this",
      attempt: 1,
      leaseToken: "11111111-1111-4111-8111-111111111111",
      contextItems: [],
    });
    const recordEvent = vi.fn().mockResolvedValue({ replayed: false });
    const worker = new AgentJobWorker({
      runnerId: "runner-worker-1",
      scratchRoot: join(tmpdir(), `ooda-worker-${crypto.randomUUID()}`),
      adapters: new Map([["codex", new SuccessfulAdapter()]]),
      api: {
        claim,
        recordEvent,
        control: vi.fn().mockResolvedValue({
          status: "running",
          cancelRequested: false,
          attempt: 1,
        }),
      },
      maxConcurrent: 1,
      controlPollMs: 10,
    });

    await worker.poll();
    await worker.waitForIdle();

    expect(claim).toHaveBeenCalledWith({
      runnerId: "runner-worker-1",
      providers: ["codex"],
      classes: [
        "read_only_research",
        "scratch_prototype",
        "comparison",
        "synthesis",
        "opportunity_review",
      ],
      leaseSeconds: 90,
    });
    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-worker-1",
        runnerId: "runner-worker-1",
        leaseToken: "11111111-1111-4111-8111-111111111111",
        type: "completed",
        payload: expect.objectContaining({
          result: expect.objectContaining({
            response: "A concise research result",
          }),
        }),
      }),
    );
    await worker.stop();
  });

  it("stops quietly when lease fencing rejects control and terminal writes", async () => {
    const claim = vi.fn().mockResolvedValueOnce({
      job: {
        id: "job-stale-lease",
        conversationId: "conversation-1",
        class: "read_only_research",
        status: "running",
        provider: "codex",
        billingPolicy: "subscription_only",
        capabilities: ["web.read"],
        budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
        createdAt: "2026-08-08T15:00:00.000Z",
        updatedAt: "2026-08-08T15:00:00.000Z",
      },
      prompt: "Research this",
      attempt: 1,
      leaseToken: "22222222-2222-4222-8222-222222222222",
      contextItems: [],
    });
    const recordEvent = vi.fn().mockRejectedValue(new Error("stale lease"));
    const worker = new AgentJobWorker({
      runnerId: "runner-stale",
      scratchRoot: join(tmpdir(), `ooda-worker-${crypto.randomUUID()}`),
      adapters: new Map([["codex", new LeaseLostAdapter()]]),
      api: {
        claim,
        recordEvent,
        control: vi.fn().mockRejectedValue(new Error("stale lease")),
      },
      maxConcurrent: 1,
      controlPollMs: 5,
    });

    await worker.poll();
    await expect(worker.waitForIdle()).resolves.toBeUndefined();
    expect(recordEvent).toHaveBeenCalled();
    await worker.stop();
  });
});
