import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { CodexAdapter } from "../codex-adapter";
import type {
  AdapterEvent,
  AdapterProcessHandle,
  McpServerConfigLike,
  SpawnedProcessLike,
} from "../types";

function fakeAppServer(
  messages: Array<Record<string, unknown>>,
  options: { requestCommandApproval?: boolean } = {},
): SpawnedProcessLike {
  const processEvents = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  let closed = false;
  const reply = (message: Record<string, unknown>) =>
    queueMicrotask(() =>
      stdout.emit("data", Buffer.from(`${JSON.stringify(message)}\n`)),
    );
  return {
    stdin: {
      destroyed: false,
      write(data: string) {
        const message = JSON.parse(data.trim()) as Record<string, unknown>;
        messages.push(message);
        if (message.method === "initialize") {
          reply({ jsonrpc: "2.0", id: message.id, result: {} });
        } else if (message.method === "account/rateLimits/read") {
          reply({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              rateLimits: {
                planType: "plus",
                primary: { usedPercent: 12, windowDurationMins: 300 },
              },
            },
          });
        } else if (message.method === "thread/start") {
          reply({
            jsonrpc: "2.0",
            id: message.id,
            result: { thread: { id: "codex-thread-1" } },
          });
        } else if (message.method === "turn/start") {
          reply({
            jsonrpc: "2.0",
            method: "turn/started",
            params: { turn: { id: "turn-1", status: "inProgress" } },
          });
          if (options.requestCommandApproval) {
            reply({
              jsonrpc: "2.0",
              id: 99,
              method: "item/commandExecution/requestApproval",
              params: { command: "pnpm test" },
            });
          } else {
            reply({
              jsonrpc: "2.0",
              method: "item/agentMessage/delta",
              params: { delta: "subscription response" },
            });
            reply({
              jsonrpc: "2.0",
              method: "turn/completed",
              params: { turn: { id: "turn-1", status: "completed" } },
            });
          }
        } else if (message.id === 99 && options.requestCommandApproval) {
          reply({
            jsonrpc: "2.0",
            method: "item/agentMessage/delta",
            params: { delta: "approved response" },
          });
          reply({
            jsonrpc: "2.0",
            method: "turn/completed",
            params: { turn: { id: "turn-1", status: "completed" } },
          });
        }
        return true;
      },
      end() {},
      on(event: "error", callback: (error: Error) => void) {
        processEvents.on(`stdin:${event}`, callback);
      },
    },
    stdout,
    stderr,
    on(event: "error" | "close", callback: (...args: unknown[]) => void) {
      processEvents.on(event, callback);
    },
    kill() {
      if (closed) return;
      closed = true;
      queueMicrotask(() => processEvents.emit("close", 0));
    },
    exitCode: null,
    signalCode: null,
  } as unknown as SpawnedProcessLike;
}

describe("CodexAdapter", () => {
  it("returns correct metadata", () => {
    const adapter = new CodexAdapter();

    expect(adapter.id).toBe("codex");
    expect(adapter.name).toBe("Codex App Server");
    expect(adapter.transport).toBe("stdio");
    expect(adapter.capabilities()).toMatchObject({
      transport: "app_server",
      supportsResume: true,
      supportsApprovals: true,
      supportsUsageInspection: true,
    });
  });

  it("is available when OPENAI_API_KEY is set", () => {
    const adapter = new CodexAdapter();

    const originalEnv = process.env.OPENAI_API_KEY;

    // With the env var, always available
    process.env.OPENAI_API_KEY = "test-key";
    expect(adapter.isAvailable()).toBe(true);

    // Without the env var, availability depends on whether the
    // codex binary is on PATH — just verify it returns a boolean
    delete process.env.OPENAI_API_KEY;
    expect(typeof adapter.isAvailable()).toBe("boolean");

    // Restore
    if (originalEnv) {
      process.env.OPENAI_API_KEY = originalEnv;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("builds the correct CLI command", () => {
    const adapter = new CodexAdapter();

    const command = adapter.buildCommand({
      prompt: "Research sleep optimization",
      workspaceRoot: "/tmp/threads/sleep",
      systemPrompt: "You are a research assistant.",
    });

    expect(command.binary).toBe("codex");
    expect(command.args.slice(0, 2)).toEqual(["app-server", "--stdio"]);
    expect(command.args).not.toContain("Research sleep optimization");
    expect(command.prompt).toBe("Research sleep optimization");
    expect(command.runtime).toMatchObject({
      systemPrompt: "You are a research assistant.",
      session: { mode: "start" },
      billingPolicy: "subscription_preferred",
    });
    expect(command.cwd).toBe("/tmp/threads/sleep");
  });

  it("adds no MCP overrides when no servers are registered", () => {
    const adapter = new CodexAdapter();
    const command = adapter.buildCommand({
      prompt: "p",
      workspaceRoot: "/tmp/ws",
    });
    expect(command.args).not.toContain("-c");
  });

  it("registers buddy-tool MCP servers via app-server config overrides", () => {
    const adapter = new CodexAdapter();
    const mcpConfig: McpServerConfigLike = {
      type: "http",
      name: "ooda-buddy-tools",
      url: "http://127.0.0.1:5123/mcp/tok-abc",
      headers: [],
    };
    adapter.registerMcpServers([mcpConfig]);

    const command = adapter.buildCommand({
      prompt: "the prompt",
      workspaceRoot: "/tmp/ws",
    });

    const cIdx = command.args.indexOf("-c");
    expect(cIdx).toBeGreaterThan(-1);
    expect(command.args[cIdx + 1]).toBe(
      'mcp_servers.ooda-buddy-tools.url="http://127.0.0.1:5123/mcp/tok-abc"',
    );
    expect(command.prompt).toBe("the prompt");
  });

  it("runs a subscription-backed app-server thread and returns native identity", async () => {
    const adapter = new CodexAdapter();
    const sent: Array<Record<string, unknown>> = [];
    const events: AdapterEvent[] = [];
    const command = adapter.buildCommand({
      prompt: "Compare the evidence",
      workspaceRoot: "/tmp/ws",
      authMode: "subscription",
      billingPolicy: "subscription_only",
      correlationId: "job-123",
    });

    const result = await adapter.execute(
      command,
      (event) => events.push(event),
      {
        environment: {
          PATH: process.env.PATH,
          HOME: "/Users/example",
          OPENAI_API_KEY: "must-not-leak",
        },
        spawnImpl: (_binary, _args, options) => {
          expect(options.env.OPENAI_API_KEY).toBeUndefined();
          return fakeAppServer(sent);
        },
      },
    );

    expect(result).toEqual({
      exitCode: 0,
      runtimeSession: {
        provider: "codex",
        sessionId: "codex-thread-1",
        turnId: "turn-1",
        transport: "app_server",
        authMode: "subscription",
      },
    });
    expect(events.some((event) => event.type === "runtime_session")).toBe(true);
    expect(
      events
        .filter((event) => event.type === "stdout")
        .map((event) => event.data),
    ).toEqual(["subscription response"]);
    expect(sent.map((message) => message.method).filter(Boolean)).toEqual([
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
    ]);
  });

  it("reads subscription rate limits through app-server without exposing an API key", async () => {
    const adapter = new CodexAdapter();
    const sent: Array<Record<string, unknown>> = [];

    const usage = await adapter.inspectUsage({
      environment: {
        PATH: process.env.PATH,
        HOME: "/Users/example",
        OPENAI_API_KEY: "must-not-leak",
      },
      spawnImpl: (_binary, _args, options) => {
        expect(options.env.OPENAI_API_KEY).toBeUndefined();
        return fakeAppServer(sent);
      },
    });

    expect(usage).toMatchObject({
      provider: "codex",
      available: true,
      rateLimits: {
        planType: "plus",
        primary: { usedPercent: 12, windowDurationMins: 300 },
      },
    });
    expect(sent.map((message) => message.method).filter(Boolean)).toEqual([
      "initialize",
      "initialized",
      "account/rateLimits/read",
    ]);
  });

  it("pauses for an OODA approval decision and returns it over JSON-RPC", async () => {
    const adapter = new CodexAdapter();
    const sent: Array<Record<string, unknown>> = [];
    const events: AdapterEvent[] = [];
    let handle: AdapterProcessHandle | undefined;
    const command = adapter.buildCommand({
      prompt: "Run the focused tests",
      workspaceRoot: "/tmp/ws",
      authMode: "subscription",
      permissionMode: "prompt",
    });

    const result = await adapter.execute(
      command,
      (event) => {
        events.push(event);
        if (event.type === "permission_request") {
          expect(
            handle?.respondPermission?.(event.permission!.requestId, "allow"),
          ).toBe(true);
        }
      },
      {
        onSpawn: (spawned) => {
          handle = spawned;
        },
        spawnImpl: () => fakeAppServer(sent, { requestCommandApproval: true }),
      },
    );

    expect(result.exitCode).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "permission_request",
        permission: expect.objectContaining({
          requestId: "codex:99",
          toolName: "item/commandExecution/requestApproval",
        }),
      }),
    );
    expect(sent).toContainEqual({
      jsonrpc: "2.0",
      id: 99,
      result: { decision: "accept" },
    });
  });
});
