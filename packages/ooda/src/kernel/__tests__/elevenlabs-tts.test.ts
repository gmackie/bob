import { describe, expect, it, vi } from "vitest";

import { streamElevenLabsTts } from "../elevenlabs-tts";

describe("ElevenLabs TTS proxy", () => {
  it("requests a zero-retention streaming response without exposing credentials", async () => {
    const upstream = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => upstream);

    const response = await streamElevenLabsTts(
      "A concise spoken answer.",
      {
        apiKey: "eleven-secret-key",
        voiceId: "voice-1",
      },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice-1/stream?enable_logging=false&output_format=mp3_44100_128",
    );
    expect(init).toBeDefined();
    if (!init) throw new Error("Expected ElevenLabs request options");
    expect(init.headers).toEqual({
      accept: "audio/mpeg",
      "content-type": "application/json",
      "xi-api-key": "eleven-secret-key",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      text: "A concise spoken answer.",
      model_id: "eleven_flash_v2_5",
    });
    expect(response).not.toBe(upstream);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.arrayBuffer()).resolves.toHaveProperty("byteLength", 3);
  });

  it("does not forward provider error bodies or credentials", async () => {
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(
      "provider diagnostic containing eleven-secret-key",
      { status: 403 },
    ));

    await expect(streamElevenLabsTts(
      "Safe text",
      { apiKey: "eleven-secret-key", voiceId: "voice-1" },
      fetchImpl,
    )).rejects.toMatchObject({ name: "ElevenLabsTtsError", status: 502 });
  });
});
