import { describe, expect, it, vi } from "vitest";

import { createHostProviderClients } from "../host-providers";

describe("conversational host providers", () => {
  it("uses xAI's Responses API for the Grok host", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          id: "resp-grok-1",
          model: "grok-4.5",
          output_text: '{"display":"Hello","speakable":"Hello"}',
        }),
      ),
    );
    const [grok] = createHostProviderClients(
      { xaiApiKey: "xai-key" },
      fetchImpl,
    );

    await expect(
      grok!.complete({
        system: "Return structured OODA output",
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).resolves.toMatchObject({
      providerResponseId: "resp-grok-1",
      model: "grok-4.5",
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.x.ai/v1/responses");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer xai-key" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "grok-4.5",
      instructions: "Return structured OODA output",
      input: [{ role: "user", content: "Hello" }],
      text: {
        format: {
          type: "json_schema",
          name: "ooda_host_response",
          strict: true,
          schema: {
            type: "object",
            properties: {
              display: { type: "string" },
              speakable: {
                anyOf: [{ type: "string" }, { type: "null" }],
              },
              proposal: {
                anyOf: [
                  { type: "null" },
                  expect.objectContaining({
                    type: "object",
                    additionalProperties: false,
                  }),
                  expect.objectContaining({
                    type: "object",
                    additionalProperties: false,
                  }),
                ],
              },
            },
            required: ["display", "speakable", "proposal"],
            additionalProperties: false,
          },
        },
      },
    });
  });

  it("enforces the same display and speakable schema with OpenAI Responses", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          id: "resp-openai-1",
          model: "gpt-5",
          output_text: '{"display":"Hello","speakable":null}',
        }),
      ),
    );
    const [openai] = createHostProviderClients(
      { openaiApiKey: "openai-key" },
      fetchImpl,
    );

    await openai!.complete({
      system: "Return structured OODA output",
      messages: [{ role: "user", content: "Hello" }],
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      text: {
        format: {
          type: "json_schema",
          name: "ooda_host_response",
          strict: true,
        },
      },
    });
  });

  it("uses Anthropic Messages with its top-level system prompt", async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          id: "msg-claude-1",
          model: "claude-opus-4-6",
          content: [
            { type: "text", text: '{"display":"Hi","speakable":"Hi"}' },
          ],
        }),
      ),
    );
    const [claude] = createHostProviderClients(
      { anthropicApiKey: "anthropic-key" },
      fetchImpl,
    );

    await claude!.complete({
      system: "Return structured OODA output",
      messages: [{ role: "user", content: "Hello" }],
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.headers).toMatchObject({
      "x-api-key": "anthropic-key",
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "claude-opus-4-6",
      system: "Return structured OODA output",
      messages: [{ role: "user", content: "Hello" }],
    });
  });
});
