import { describe, expect, it, vi } from "vitest";

import { MusicGenerationError } from "../../kernel/lyria-music";
import { createMusicGenerationHttpResponse } from "../music-http";

const post = (body: unknown) =>
  new Request("https://ooda.test/api/v1/music/generations", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const valid = { model: "google/lyria-3.5", prompt: "Warm acoustic soul", idempotencyKey: "song-1-take-1" };

describe("createMusicGenerationHttpResponse", () => {
  it("returns the generated audio inline", async () => {
    const generate = vi.fn(async () => ({
      id: "gen-1",
      model: "google/lyria-3.5" as const,
      mimeType: "audio/mpeg",
      audio: "SUQz",
      lyrics: "[[B1]]",
      outputTokens: 10,
      costUsd: 0.08,
    }));
    const response = await createMusicGenerationHttpResponse({ request: post(valid), generate });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: "gen-1",
      model: "google/lyria-3.5",
      mimeType: "audio/mpeg",
      audio: "SUQz",
      lyrics: "[[B1]]",
      costUsd: 0.08,
      usage: { outputTokens: 10 },
    });
    expect(generate).toHaveBeenCalledWith(valid);
  });

  it.each([
    ["an unknown model", { ...valid, model: "google/lyria-002" }],
    ["an empty prompt", { ...valid, prompt: "  " }],
    ["a short idempotency key", { ...valid, idempotencyKey: "x" }],
    ["invalid JSON", "{"],
  ])("rejects %s without generating", async (_, body) => {
    const generate = vi.fn();
    const response = await createMusicGenerationHttpResponse({ request: post(body), generate });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("VALIDATION_FAILED");
    expect(generate).not.toHaveBeenCalled();
  });

  it("maps a refused prompt to a 422 problem with the provider's reason", async () => {
    const response = await createMusicGenerationHttpResponse({
      request: post(valid),
      generate: async () => {
        throw new MusicGenerationError("MUSIC_PROMPT_REFUSED", "Input blocked: prohibited use");
      },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "MUSIC_PROMPT_REFUSED",
      detail: "Input blocked: prohibited use",
    });
  });

  it("hides unexpected errors", async () => {
    const response = await createMusicGenerationHttpResponse({
      request: post(valid),
      generate: async () => {
        throw new Error("connection string leaked");
      },
    });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("leaked");
  });
});
