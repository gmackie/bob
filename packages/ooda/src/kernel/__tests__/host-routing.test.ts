import { describe, expect, it, vi } from "vitest";

import {
  normalizeHostOutput,
  routeHostCompletion,
  type HostProviderClient,
} from "../host-routing";

function provider(
  id: HostProviderClient["id"],
  complete: HostProviderClient["complete"],
): HostProviderClient {
  return { id, complete };
}

describe("host routing", () => {
  it("falls back from Grok to Claude visibly without changing conversation identity", async () => {
    const grok = provider(
      "grok",
      vi.fn(() => Promise.reject(new Error("rate limited"))),
    );
    const claude = provider(
      "claude",
      vi.fn(() =>
        Promise.resolve({
          providerResponseId: "claude-response-1",
          model: "claude-opus-4-6",
          text: '{"display":"Full answer","speakable":"Short answer"}',
        }),
      ),
    );
    const openai = provider(
      "openai",
      vi.fn(() => Promise.reject(new Error("unused"))),
    );

    const result = await routeHostCompletion({
      preferredProvider: "grok",
      providers: [grok, claude, openai],
      messages: [{ role: "user", content: "Help me think" }],
      system: "OODA host",
    });

    expect(result).toMatchObject({
      provider: "claude",
      model: "claude-opus-4-6",
      output: { display: "Full answer", speakable: "Short answer" },
      fallback: {
        preferredProvider: "grok",
        failures: [{ provider: "grok", code: "PROVIDER_FAILED" }],
      },
    });
    expect(openai.complete).not.toHaveBeenCalled();
  });

  it("keeps rich display text while omitting unsafe speech", () => {
    expect(normalizeHostOutput("```ts\nconst token = 'secret';\n```")).toEqual({
      display: "```ts\nconst token = 'secret';\n```",
    });
  });
});
