import { describe, expect, it } from "vitest";

import { buildProviderCommand, normalizeProviderId, parseProviderStream, ProviderRunController } from "./runtime.js";

describe("provider runtime", () => {
  it.each([
    ["claude", "claude", ["--output-format", "stream-json"]],
    ["codex", "codex", ["exec", "--json"]],
    ["grok", "grok", ["--single", "--output-format", "streaming-json", "--permission-mode", "bypassPermissions"]],
    ["cursor-agent", "cursor-agent", ["--print", "--output-format", "stream-json", "--trust", "--force"]],
  ] as const)("builds a structured command for %s", (provider, command, requiredArgs) => {
    const result = buildProviderCommand(provider, "Inspect the repository", { sandbox: "workspace-write" });
    expect(result.command).toBe(command);
    expect(result.args).toEqual(expect.arrayContaining([...requiredArgs, "Inspect the repository"]));
  });

  it("normalizes usage and native session IDs from JSONL", () => {
    const parsed = parseProviderStream(
      "codex",
      `${JSON.stringify({ type: "session.started", thread_id: "thread-1" })}\n${JSON.stringify({ usage: { input_tokens: 20, output_tokens: 5 } })}`,
    );

    expect(parsed).toMatchObject({
      nativeSessionId: "thread-1",
      usage: { source: "provider", inputTokens: 20, outputTokens: 5 },
    });
  });

  it("parses Cursor's camel-case usage fields", () => {
    const parsed = parseProviderStream(
      "cursor-agent",
      JSON.stringify({ type: "result", session_id: "cursor-1", usage: { inputTokens: 12, outputTokens: 3 } }),
    );

    expect(parsed.usage).toMatchObject({ source: "provider", inputTokens: 12, outputTokens: 3 });
  });

  it("cancels only once", () => {
    let cancellations = 0;
    const controller = new ProviderRunController(() => cancellations++);
    expect(controller.cancel()).toBe(true);
    expect(controller.cancel()).toBe(false);
    expect(cancellations).toBe(1);
  });

  it("normalizes legacy Cursor rows instead of falling through to Claude", () => {
    expect(normalizeProviderId("cursor")).toBe("cursor-agent");
    expect(normalizeProviderId("cursor-agent")).toBe("cursor-agent");
    expect(normalizeProviderId("unknown")).toBeNull();
  });
});
