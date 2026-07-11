import { describe, expect, it } from "vitest";

import { buildProviderCommand, parseProviderStream, ProviderRunController } from "./runtime.js";

describe("provider runtime", () => {
  it.each([
    ["claude", "claude", ["--output-format", "stream-json"]],
    ["codex", "codex", ["exec", "--json"]],
    ["grok", "grok", ["--print", "--output-format", "streaming-json"]],
    ["cursor-agent", "cursor-agent", ["--print", "--output-format", "stream-json"]],
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

  it("cancels only once", () => {
    let cancellations = 0;
    const controller = new ProviderRunController(() => cancellations++);
    expect(controller.cancel()).toBe(true);
    expect(controller.cancel()).toBe(false);
    expect(cancellations).toBe(1);
  });
});
