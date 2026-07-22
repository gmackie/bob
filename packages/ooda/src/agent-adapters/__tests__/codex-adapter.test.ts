import { describe, expect, it } from "vitest";

import { CodexAdapter } from "../codex-adapter";
import type { McpServerConfigLike } from "../types";

describe("CodexAdapter", () => {
  it("returns correct metadata", () => {
    const adapter = new CodexAdapter();

    expect(adapter.id).toBe("codex");
    expect(adapter.name).toBe("Codex CLI");
    expect(adapter.transport).toBe("stdio");
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
    expect(command.args[0]).toBe("exec");
    expect(command.args).toContain("Research sleep optimization");
    expect(command.cwd).toBe("/tmp/threads/sleep");
  });

  it("adds no MCP overrides when no servers are registered", () => {
    const adapter = new CodexAdapter();
    const command = adapter.buildCommand({ prompt: "p", workspaceRoot: "/tmp/ws" });
    expect(command.args).not.toContain("-c");
  });

  it("registers buddy-tool MCP servers via `-c mcp_servers.*` before the prompt", () => {
    const adapter = new CodexAdapter();
    const mcpConfig: McpServerConfigLike = {
      type: "http",
      name: "ooda-buddy-tools",
      url: "http://127.0.0.1:5123/mcp/tok-abc",
      headers: [],
    };
    adapter.registerMcpServers([mcpConfig]);

    const command = adapter.buildCommand({ prompt: "the prompt", workspaceRoot: "/tmp/ws" });

    const cIdx = command.args.indexOf("-c");
    expect(cIdx).toBeGreaterThan(-1);
    expect(command.args[cIdx + 1]).toBe(
      'mcp_servers.ooda-buddy-tools.url="http://127.0.0.1:5123/mcp/tok-abc"',
    );
    // Positional prompt stays last.
    expect(command.args[command.args.length - 1]).toBe("the prompt");
  });
});
