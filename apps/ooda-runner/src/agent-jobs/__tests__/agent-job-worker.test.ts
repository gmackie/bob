import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import type {
  AdapterCommand,
  AdapterEvent,
  AgentAdapter,
  BuildCommandOptions,
} from "@gmacko/ooda/agent-adapters";

import { AgentJobWorker } from "../agent-job-worker";

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

describe("AgentJobWorker", () => {
  it("executes the disposable lane and records findings without a Bob run", async () => {
    const claim = vi.fn().mockResolvedValueOnce({
      job: {
        id: "job-worker-1",
        conversationId: "conversation-1",
        class: "read_only_research",
        status: "running",
        provider: "codex",
        capabilities: ["web.read"],
        budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
        createdAt: "2026-08-07T15:00:00.000Z",
        updatedAt: "2026-08-07T15:00:00.000Z",
      },
      prompt: "Research this",
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
});
