import { describe, it, expect } from "vitest";

import { buildArgs, claudeCodeAdapter } from "../claude-code-adapter.js";

describe("ClaudeCodeCliAdapter — buildArgs + factory skeleton", () => {
  it("emits the base flags in stable order and omits optional flags when absent", () => {
    const args = buildArgs({ prompt: "hi" });

    expect(args).toEqual([
      "--bare",
      "-p",
      "hi",
      "--output-format",
      "stream-json",
      "--no-session-persistence",
    ]);

    expect(args).not.toContain("--resume");
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--append-system-prompt");
  });

  it("forwards --resume and --allowedTools (CSV) when provided; skips --allowedTools for empty arrays", () => {
    const args = buildArgs({
      prompt: "go",
      resumeSessionId: "abc-123",
      allowedTools: ["Read", "Edit", "Bash"],
    });

    const resumeIdx = args.indexOf("--resume");
    expect(resumeIdx).toBeGreaterThanOrEqual(0);
    expect(args[resumeIdx + 1]).toBe("abc-123");

    const allowedIdx = args.indexOf("--allowedTools");
    expect(allowedIdx).toBeGreaterThanOrEqual(0);
    expect(args[allowedIdx + 1]).toBe("Read,Edit,Bash");

    const emptyArgs = buildArgs({ prompt: "go", allowedTools: [] });
    expect(emptyArgs).not.toContain("--allowedTools");
  });

  it("forwards the system prompt verbatim via --append-system-prompt (no shell escaping)", () => {
    const args = buildArgs({
      prompt: "go",
      systemPrompt: "You are terse.",
    });

    const sysIdx = args.indexOf("--append-system-prompt");
    expect(sysIdx).toBeGreaterThanOrEqual(0);
    expect(args[sysIdx + 1]).toBe("You are terse.");
  });

  it("factory returns an AgentAdapter with adapterId=claude-code and a sendTurn function", () => {
    const adapter = claudeCodeAdapter();
    expect(adapter.adapterId).toBe("claude-code");
    expect(typeof adapter.sendTurn).toBe("function");
  });
});
