import { describe, expect, it, vi } from "vitest";

import {
  createTtsGrantHttpResponse,
  createTtsStreamHttpResponse,
} from "../tts-http";

describe("TTS HTTP resources", () => {
  it("rejects client-selected text before creating a grant", async () => {
    const createGrant = vi.fn();
    const response = await createTtsGrantHttpResponse({
      request: new Request("https://ooda.example/api/v1/tts-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: "conversation-1",
          eventId: "event-1",
          requestMode: "manual",
          idempotencyKey: "device-1",
          text: "Read this arbitrary value",
        }),
      }),
      createGrant,
    });

    expect(response.status).toBe(422);
    expect(createGrant).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      version: "v1",
      code: "VALIDATION_FAILED",
    });
  });

  it("streams only text returned by consuming the one-use grant", async () => {
    const consumeGrant = vi.fn(async () => ({
      text: "Canonical speakable text.",
      grantId: "grant-1",
    }));
    const streamSpeech = vi.fn(async () => new Response(new Uint8Array([1]), {
      headers: { "content-type": "audio/mpeg" },
    }));

    const response = await createTtsStreamHttpResponse({
      token: "grant-1.signature",
      consumeGrant,
      streamSpeech,
    });

    expect(consumeGrant).toHaveBeenCalledWith("grant-1.signature");
    expect(streamSpeech).toHaveBeenCalledWith("Canonical speakable text.");
    expect(response.status).toBe(200);
  });
});
