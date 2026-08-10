import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import type {
  AdapterCommand,
  AdapterEvent,
  AgentAdapter,
  BuildCommandOptions,
} from "@gmacko/ooda/agent-adapters";

import { HostTurnWorker } from "../host-turn-worker";

class HostAdapter implements AgentAdapter {
  name = "Host adapter";
  transport = "stdio" as const;
  commands: BuildCommandOptions[] = [];

  constructor(
    public id: string,
    private readonly response: string | Error,
  ) {}

  isAvailable() {
    return true;
  }

  buildCommand(options: BuildCommandOptions): AdapterCommand {
    this.commands.push(options);
    return {
      binary: "mock",
      args: [],
      cwd: options.workspaceRoot,
      prompt: options.prompt,
      runtime: {
        systemPrompt: options.systemPrompt,
        permissionMode: options.permissionMode ?? "prompt",
        billingPolicy: options.billingPolicy ?? "subscription_only",
        authMode: options.authMode ?? "subscription",
        session: options.session,
      },
    };
  }

  async execute(
    _command: AdapterCommand,
    onEvent: (event: AdapterEvent) => void,
  ) {
    if (this.response instanceof Error) throw this.response;
    onEvent({
      type: "stdout",
      data: this.response,
      timestamp: "2026-08-08T19:00:00.000Z",
    });
    const runtimeSession = {
      provider: this.id,
      sessionId: `${this.id}-session-1`,
      turnId: "turn-1",
      transport:
        this.id === "codex" ? ("app_server" as const) : ("cli" as const),
      authMode: "subscription" as const,
    };
    onEvent({
      type: "runtime_session",
      data: runtimeSession.sessionId,
      timestamp: "2026-08-08T19:00:00.000Z",
      runtimeSession,
    });
    return { exitCode: 0, runtimeSession };
  }
}

describe("HostTurnWorker", () => {
  it("uses subscription CLIs in constitutional fallback order and records the native session", async () => {
    const root = join(tmpdir(), `ooda-host-worker-${crypto.randomUUID()}`);
    const trustedHome = join(root, "trusted-home");
    await Promise.all([
      mkdir(join(trustedHome, ".grok"), { recursive: true }),
      mkdir(join(trustedHome, ".claude"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(trustedHome, ".grok", "auth.json"), "grok-token"),
      writeFile(
        join(trustedHome, ".claude", ".credentials.json"),
        "claude-token",
      ),
    ]);
    const grok = new HostAdapter("grok", new Error("Grok unavailable"));
    const claude = new HostAdapter(
      "claude",
      JSON.stringify({
        display: "Use the smallest test.",
        speakable: "Use the smallest test.",
      }),
    );
    const complete = vi.fn().mockResolvedValue({});
    const fail = vi.fn().mockResolvedValue({});
    const worker = new HostTurnWorker({
      runnerId: "runner-host",
      scratchRoot: join(root, "scratch"),
      adapters: new Map([
        ["grok", grok],
        ["claude", claude],
      ]),
      maxConcurrent: 1,
      environment: { PATH: "/usr/bin", HOME: trustedHome },
      processSandbox: async (command) => command,
      api: {
        claim: vi.fn().mockResolvedValueOnce({
          executionId: "execution-1",
          conversationId: "conversation-1",
          userEventId: "event-1",
          contextPackId: "context-1",
          preferredProvider: "grok",
          providerOrder: ["grok", "claude"],
          messages: [{ role: "user", content: "What is the next step?" }],
          system: "You are OODA. Return display and speakable JSON.",
          sensitivity: "personal",
          correlationId: "correlation-1",
          attempt: 1,
          leaseToken: "11111111-1111-4111-8111-111111111111",
        }),
        complete,
        fail,
      },
    });

    await worker.poll();
    await worker.waitForIdle();

    expect(grok.commands[0]).toMatchObject({
      authMode: "subscription",
      billingPolicy: "subscription_only",
      allowedTools: [],
    });
    expect(claude.commands[0]).toMatchObject({
      authMode: "subscription",
      billingPolicy: "subscription_only",
      allowedTools: [],
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "execution-1",
        provider: "claude",
        response: expect.stringContaining("Use the smallest test"),
        failures: [{ provider: "grok", code: "PROVIDER_FAILED" }],
        runtimeSession: expect.objectContaining({
          provider: "claude",
          sessionId: "claude-session-1",
          authMode: "subscription",
        }),
      }),
    );
    expect(fail).not.toHaveBeenCalled();
    await worker.stop();
    await rm(root, { recursive: true, force: true });
  });

  it("maps the OpenAI host identity to the Codex app-server subscription", async () => {
    const root = join(tmpdir(), `ooda-host-worker-${crypto.randomUUID()}`);
    const trustedHome = join(root, "trusted-home");
    await mkdir(join(trustedHome, ".codex"), { recursive: true });
    await writeFile(
      join(trustedHome, ".codex", "auth.json"),
      "codex-token",
    );
    const codex = new HostAdapter(
      "codex",
      JSON.stringify({ display: "Codex answer", speakable: "Codex answer" }),
    );
    const complete = vi.fn().mockResolvedValue({});
    let sandboxOptions:
      | { writablePaths?: string[]; readOnlyPaths?: string[] }
      | undefined;
    const worker = new HostTurnWorker({
      runnerId: "runner-host",
      scratchRoot: join(root, "scratch"),
      adapters: new Map([["codex", codex]]),
      maxConcurrent: 1,
      environment: { PATH: "/usr/bin", HOME: trustedHome },
      processSandbox: async (command, _scratchPath, options) => {
        sandboxOptions = options;
        return command;
      },
      api: {
        claim: vi.fn().mockResolvedValueOnce({
          executionId: "execution-openai",
          conversationId: "conversation-1",
          userEventId: "event-1",
          contextPackId: "context-1",
          preferredProvider: "openai",
          providerOrder: ["openai"],
          messages: [
            { role: "user", content: "Respond through my subscription." },
          ],
          system: "You are OODA.",
          sensitivity: "general",
          correlationId: "correlation-openai",
          attempt: 1,
          leaseToken: "22222222-2222-4222-8222-222222222222",
        }),
        complete,
        fail: vi.fn(),
      },
    });

    await worker.poll();
    await worker.waitForIdle();

    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        runtimeSession: expect.objectContaining({
          provider: "openai",
          transport: "app_server",
        }),
      }),
    );
    expect(sandboxOptions).toBeDefined();
    const runtimeHome = sandboxOptions?.writablePaths?.[0];
    expect(runtimeHome).toBeDefined();
    expect(sandboxOptions?.readOnlyPaths).toEqual([
      join(runtimeHome!, ".codex", "auth.json"),
    ]);
    await worker.stop();
    await rm(root, { recursive: true, force: true });
  });
});
