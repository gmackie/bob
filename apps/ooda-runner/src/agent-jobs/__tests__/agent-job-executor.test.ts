import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import type {
  AdapterCommand,
  AdapterEvent,
  AdapterProcessHandle,
  AgentAdapter,
  BuildCommandOptions,
  ExecuteOptions,
} from "@gmacko/ooda/agent-adapters";

import { AgentJobExecutor } from "../agent-job-executor";
import { ScratchSandboxManager } from "../scratch-sandbox";

class BlockingAdapter implements AgentAdapter {
  id = "codex";
  name = "Blocking adapter";
  transport = "stdio" as const;
  killed = false;
  environment: Record<string, string | undefined> | undefined;
  command: AdapterCommand | undefined;

  isAvailable() {
    return true;
  }

  buildCommand(opts: BuildCommandOptions): AdapterCommand {
    return { binary: "mock", args: [], cwd: opts.workspaceRoot };
  }

  execute(
    command: AdapterCommand,
    _onEvent: (event: AdapterEvent) => void,
    options?: ExecuteOptions,
  ): Promise<{ exitCode: number }> {
    this.command = command;
    this.environment = options?.environment;
    return new Promise((resolve) => {
      const handle: AdapterProcessHandle = {
        write: () => false,
        kill: () => {
          this.killed = true;
          resolve({ exitCode: 143 });
        },
      };
      options?.onSpawn?.(handle);
    });
  }
}

describe("AgentJobExecutor", () => {
  it("kills cancelled work, scrubs credentials, and removes its sandbox", async () => {
    const root = join(tmpdir(), `ooda-job-executor-${crypto.randomUUID()}`);
    const adapter = new BlockingAdapter();
    const executor = new AgentJobExecutor({
      adapter,
      sandboxes: new ScratchSandboxManager(root),
      environment: {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "selected-provider-key",
        DATABASE_URL: "must-not-leak",
      },
    });
    const controller = new AbortController();
    const running = executor.execute({
      jobId: "job-cancel",
      class: "read_only_research",
      provider: "codex",
      prompt: "Research only",
      capabilities: ["web.read"],
      budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
      signal: controller.signal,
      onEvent: vi.fn(),
    });
    await vi.waitFor(() => expect(adapter.environment).toBeDefined());
    const sandboxPath = adapter.environment!.HOME!.replace(/\/\.home$/, "");
    controller.abort();

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter.killed).toBe(true);
    expect(adapter.environment).toMatchObject({
      OPENAI_API_KEY: "selected-provider-key",
    });
    expect(adapter.environment).not.toHaveProperty("DATABASE_URL");
    expect(adapter.command?.binary).toBe("/usr/bin/sandbox-exec");
    expect(adapter.command?.args.join(" ")).toContain("(deny file-write*)");
    await expect(lstat(sandboxPath)).rejects.toMatchObject({ code: "ENOENT" });
    await new ScratchSandboxManager(root).cleanupRoot();
  });
});
