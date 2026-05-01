import { describe, expect, it } from "vitest";

import { CodexAdapter } from "../codex-adapter";

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
});
