import { describe, expect, it } from "vitest";

import { CursorAgentAdapter } from "../cursor-agent-adapter";

describe("CursorAgentAdapter", () => {
  it("returns correct metadata", () => {
    const adapter = new CursorAgentAdapter();

    expect(adapter.id).toBe("cursor-agent");
    expect(adapter.name).toBe("Cursor Agent");
    expect(adapter.transport).toBe("stdio");
  });

  it("is available when CURSOR_API_KEY is set", () => {
    const adapter = new CursorAgentAdapter();
    const originalEnv = process.env.CURSOR_API_KEY;

    process.env.CURSOR_API_KEY = "test-key";
    expect(adapter.isAvailable()).toBe(true);

    delete process.env.CURSOR_API_KEY;
    expect(typeof adapter.isAvailable()).toBe("boolean");

    if (originalEnv) {
      process.env.CURSOR_API_KEY = originalEnv;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
  });

  it("builds the correct CLI command", () => {
    const adapter = new CursorAgentAdapter();

    const command = adapter.buildCommand({
      prompt: "Inspect the failing chat route",
      workspaceRoot: "/tmp/threads/chat",
      systemPrompt: "You are running in Bob.",
    });

    expect(command.binary).toBe("cursor-agent");
    expect(command.args).toContain("--print");
    expect(command.args).toContain("--force");
    expect(command.args).toContain("You are running in Bob.\n\nInspect the failing chat route");
    expect(command.cwd).toBe("/tmp/threads/chat");
  });
});
