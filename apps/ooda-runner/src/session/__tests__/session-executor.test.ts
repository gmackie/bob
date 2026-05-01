import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { SessionExecutor } from "../session-executor";
import type {
  AgentAdapter,
  AdapterCommand,
  AdapterEvent,
} from "@gmacko/ooda/agent-adapters";

class MockAdapter implements AgentAdapter {
  id = "mock";
  name = "Mock Adapter";
  transport = "stdio" as const;

  constructor(private outputChunks?: string[]) {}

  isAvailable(): boolean {
    return true;
  }

  buildCommand(opts: {
    prompt: string;
    workspaceRoot: string;
    systemPrompt?: string;
  }): AdapterCommand {
    return {
      binary: "echo",
      args: [opts.prompt],
      cwd: opts.workspaceRoot,
    };
  }

  async execute(
    _command: AdapterCommand,
    onEvent: (event: AdapterEvent) => void,
  ): Promise<{ exitCode: number }> {
    // Simulate agent output
    const chunks = this.outputChunks ?? [
      "Research finding: Blackout curtains reduce sleep latency by 15 minutes.",
    ];
    for (const chunk of chunks) {
      onEvent({
        type: "stdout",
        data: chunk,
        timestamp: new Date().toISOString(),
      });
    }

    onEvent({
      type: "exit",
      data: "",
      timestamp: new Date().toISOString(),
      exitCode: 0,
    });

    return { exitCode: 0 };
  }
}

class FailingAdapter implements AgentAdapter {
  id = "failing";
  name = "Failing Adapter";
  transport = "stdio" as const;

  isAvailable(): boolean {
    return true;
  }

  buildCommand(opts: {
    prompt: string;
    workspaceRoot: string;
    systemPrompt?: string;
  }): AdapterCommand {
    return {
      binary: "echo",
      args: [opts.prompt],
      cwd: opts.workspaceRoot,
    };
  }

  async execute(
    _command: AdapterCommand,
    onEvent: (event: AdapterEvent) => void,
  ): Promise<{ exitCode: number }> {
    onEvent({
      type: "stdout",
      data: "error: something went wrong\n",
      timestamp: new Date().toISOString(),
    });

    onEvent({
      type: "exit",
      data: "",
      timestamp: new Date().toISOString(),
      exitCode: 1,
    });

    return { exitCode: 1 };
  }
}

class ThrowingAdapter implements AgentAdapter {
  id = "throwing";
  name = "Throwing Adapter";
  transport = "stdio" as const;

  isAvailable(): boolean {
    return true;
  }

  buildCommand(opts: {
    prompt: string;
    workspaceRoot: string;
    systemPrompt?: string;
  }): AdapterCommand {
    return {
      binary: "echo",
      args: [opts.prompt],
      cwd: opts.workspaceRoot,
    };
  }

  async execute(
    _command: AdapterCommand,
    _onEvent: (event: AdapterEvent) => void,
  ): Promise<{ exitCode: number }> {
    throw new Error("Adapter crashed: out of memory");
  }
}

function initVaultRepo(root: string) {
  execSync("git init", { cwd: root, stdio: "pipe" });
  execSync('git -c user.name="Test" -c user.email="test@test" commit --allow-empty -m "init"', {
    cwd: root,
    stdio: "pipe",
  });
}

describe("SessionExecutor", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("executes a session and captures output", async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "ooda-exec-"));
    tempDirs.push(storageRoot);
    initVaultRepo(storageRoot);

    const events: AdapterEvent[] = [];
    const executor = new SessionExecutor({
      adapter: new MockAdapter(),
      storageRoot,
    });

    const result = await executor.execute({
      threadSlug: "sleep-test",
      threadTitle: "Sleep Test",
      sessionId: "session_1",
      prompt: "Research sleep optimization",
      toolProfileId: "research-light",
      onEvent: (event) => events.push(event),
    });

    expect(result.exitCode).toBe(0);
    expect(result.rawOutput).toContain("Blackout curtains");
    expect(result.agentResponse).toContain("Blackout curtains");
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "stdout")).toBe(true);
  });

  it("creates thread workspace if it does not exist", async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "ooda-exec-"));
    tempDirs.push(storageRoot);
    initVaultRepo(storageRoot);

    const executor = new SessionExecutor({
      adapter: new MockAdapter(),
      storageRoot,
    });

    await executor.execute({
      threadSlug: "new-thread",
      threadTitle: "New Thread",
      sessionId: "session_1",
      prompt: "Start research",
      toolProfileId: "research-light",
      onEvent: () => {},
    });

    expect(existsSync(join(storageRoot, "new-thread", ".git"))).toBe(false);
    expect(existsSync(join(storageRoot, ".git"))).toBe(true);
    expect(existsSync(join(storageRoot, "new-thread", "thread.json"))).toBe(
      true,
    );
  });

  it("extracts agentResponse from output with agent marker", async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "ooda-exec-"));
    tempDirs.push(storageRoot);
    initVaultRepo(storageRoot);

    const adapter = new MockAdapter([
      "OpenAI Codex v0.1\n--------\n",
      "user prompt here\n",
      "codex\n",
      "The answer is 42.\n",
    ]);
    const executor = new SessionExecutor({ adapter, storageRoot });

    const result = await executor.execute({
      threadSlug: "marker-test",
      threadTitle: "Marker Test",
      sessionId: "session_marker",
      prompt: "What is the answer?",
      toolProfileId: "research-light",
      onEvent: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.rawOutput).toContain("codex");
    expect(result.agentResponse).toBe("The answer is 42.");
  });

  it("returns rawOutput and agentResponse separately", async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "ooda-exec-"));
    tempDirs.push(storageRoot);
    initVaultRepo(storageRoot);

    const adapter = new MockAdapter([
      "claude\n",
      "Here is my response.\n",
      "\ntokens used\n1,234\n",
    ]);
    const executor = new SessionExecutor({ adapter, storageRoot });

    const result = await executor.execute({
      threadSlug: "separate-test",
      threadTitle: "Separate Test",
      sessionId: "session_sep",
      prompt: "Tell me something",
      toolProfileId: "research-light",
      onEvent: () => {},
    });

    // rawOutput includes everything including token noise
    expect(result.rawOutput).toContain("tokens used");
    // agentResponse should have noise stripped
    expect(result.agentResponse).toBe("Here is my response.");
  });

  it("propagates non-zero exit code in result", async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "ooda-exec-"));
    tempDirs.push(storageRoot);
    initVaultRepo(storageRoot);

    const executor = new SessionExecutor({
      adapter: new FailingAdapter(),
      storageRoot,
    });

    const result = await executor.execute({
      threadSlug: "fail-thread",
      threadTitle: "Fail Thread",
      sessionId: "session_fail",
      prompt: "This will fail",
      toolProfileId: "research-light",
      onEvent: () => {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.rawOutput).toContain("something went wrong");
  });

  it("propagates adapter execute errors instead of swallowing them", async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "ooda-exec-"));
    tempDirs.push(storageRoot);
    initVaultRepo(storageRoot);

    const executor = new SessionExecutor({
      adapter: new ThrowingAdapter(),
      storageRoot,
    });

    await expect(
      executor.execute({
        threadSlug: "error-thread",
        threadTitle: "Error Thread",
        sessionId: "session_err",
        prompt: "This will fail",
        toolProfileId: "research-light",
        onEvent: () => {},
      }),
    ).rejects.toThrow("Adapter crashed: out of memory");
  });
});
