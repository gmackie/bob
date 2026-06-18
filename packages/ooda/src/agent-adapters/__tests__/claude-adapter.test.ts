import { describe, expect, it } from "vitest";

import { ClaudeAdapter } from "../claude-adapter";

describe("ClaudeAdapter", () => {
  it("returns correct metadata", () => {
    const adapter = new ClaudeAdapter();

    expect(adapter.id).toBe("claude");
    expect(adapter.name).toBe("Claude Code");
    expect(adapter.transport).toBe("api");
  });

  it("is available when ANTHROPIC_API_KEY is set", () => {
    const adapter = new ClaudeAdapter();

    const originalEnv = process.env.ANTHROPIC_API_KEY;

    // With the env var, always available
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(adapter.isAvailable()).toBe(true);

    // Without the env var, availability depends on whether the
    // claude binary is on PATH — just verify it returns a boolean
    delete process.env.ANTHROPIC_API_KEY;
    expect(typeof adapter.isAvailable()).toBe("boolean");

    // Restore
    if (originalEnv) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("builds the correct CLI command for claude CLI", () => {
    const adapter = new ClaudeAdapter();

    const command = adapter.buildCommand({
      prompt: "Research sleep optimization",
      workspaceRoot: "/tmp/threads/sleep",
      systemPrompt: "You are a research assistant.",
    });

    expect(command.binary).toBe("claude");
    expect(command.args).toContain("--print");
    expect(command.args).toContain("Research sleep optimization");
    expect(command.cwd).toBe("/tmp/threads/sleep");
  });
});
