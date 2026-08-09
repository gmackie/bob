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

class PermissionRequestingAdapter implements AgentAdapter {
  id = "claude";
  name = "Permission requesting adapter";
  transport = "stdio" as const;
  decisions: Array<{
    requestId: string;
    behavior: "allow" | "deny";
    message?: string;
  }> = [];

  isAvailable() {
    return true;
  }

  buildCommand(opts: BuildCommandOptions): AdapterCommand {
    return { binary: "mock", args: [], cwd: opts.workspaceRoot };
  }

  async execute(
    _command: AdapterCommand,
    onEvent: (event: AdapterEvent) => void,
    options?: ExecuteOptions,
  ): Promise<{ exitCode: number }> {
    options?.onSpawn?.({
      write: () => false,
      kill: () => {},
      respondPermission: (requestId, behavior, message) => {
        this.decisions.push({ requestId, behavior, message });
        return true;
      },
    });
    onEvent({
      type: "permission_request",
      data: "Bash requires approval",
      timestamp: "2026-08-08T15:00:00.000Z",
      permission: {
        requestId: "permission-1",
        toolName: "Bash",
        input: { command: "cat ~/.ssh/config" },
      },
    });
    return { exitCode: 0 };
  }
}

describe("AgentJobExecutor", () => {
  it("denies undeclared tool requests immediately instead of leaving a headless job blocked", async () => {
    const root = join(tmpdir(), `ooda-job-permission-${crypto.randomUUID()}`);
    const adapter = new PermissionRequestingAdapter();
    const executor = new AgentJobExecutor({
      adapter,
      sandboxes: new ScratchSandboxManager(root),
      environment: { PATH: "/usr/bin", HOME: "/Users/operator" },
    });

    await executor.execute({
      jobId: "job-permission",
      class: "read_only_research",
      provider: "claude",
      prompt: "Read the disclosed evidence",
      billingPolicy: "subscription_only",
      authMode: "subscription",
      capabilities: ["project_context.read", "web.read"],
      budget: { deadlineSeconds: 900, aggregateTokens: 150_000 },
      onEvent: vi.fn(),
    });

    expect(adapter.decisions).toEqual([
      {
        requestId: "permission-1",
        behavior: "deny",
        message: "Tool is outside this OODA job's declared capabilities",
      },
    ]);
    await new ScratchSandboxManager(root).cleanupRoot();
  });

  it("kills cancelled work, scrubs credentials, and removes its sandbox", async () => {
    const root = join(tmpdir(), `ooda-job-executor-${crypto.randomUUID()}`);
    const adapter = new BlockingAdapter();
    const executor = new AgentJobExecutor({
      adapter,
      sandboxes: new ScratchSandboxManager(root),
      processSandbox: async (command) =>
        process.platform === "darwin"
          ? {
              ...command,
              binary: "/usr/bin/sandbox-exec",
              args: [
                "-p",
                "(deny file-write*)",
                "--",
                command.binary,
                ...command.args,
              ],
            }
          : {
              ...command,
              binary: "/usr/bin/bwrap",
              args: [
                "--die-with-parent",
                "--cap-drop",
                "ALL",
                "--",
                command.binary,
                ...command.args,
              ],
            },
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
      billingPolicy: "metered_allowed",
      authMode: "api_key",
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
    if (process.platform === "darwin") {
      expect(adapter.command?.binary).toBe("/usr/bin/sandbox-exec");
      expect(adapter.command?.args.join(" ")).toContain("(deny file-write*)");
    } else if (process.platform === "linux") {
      expect(adapter.command?.binary).toBe("/usr/bin/bwrap");
      expect(adapter.command?.args).toEqual(
        expect.arrayContaining(["--die-with-parent", "--cap-drop", "ALL"]),
      );
    }
    await expect(lstat(sandboxPath)).rejects.toMatchObject({ code: "ENOENT" });
    await new ScratchSandboxManager(root).cleanupRoot();
  });
});
