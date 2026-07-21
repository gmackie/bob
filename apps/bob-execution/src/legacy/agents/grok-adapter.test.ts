import { describe, expect, it } from "vitest";

import { GrokAdapter } from "./grok-adapter.js";

describe("GrokAdapter", () => {
  it("uses Grok headless streaming JSON mode", () => {
    expect(new GrokAdapter().getSpawnArgs()).toMatchObject({
      command: "grok",
      args: ["--print", "--output-format", "streaming-json"],
    });
  });

  it("parses usage from a streaming JSON line and ignores malformed lines", () => {
    const output = [
      "not-json",
      JSON.stringify({ usage: { input_tokens: 41, output_tokens: 9, cost: 0.12 } }),
    ].join("\n");

    expect(new GrokAdapter().parseOutput(output)).toEqual({
      inputTokens: 41,
      outputTokens: 9,
      cost: 0.12,
    });
  });
});
