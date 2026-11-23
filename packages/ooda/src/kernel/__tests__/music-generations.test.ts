import { describe, expect, it, vi } from "vitest";

import { generateLyriaSong, MusicGenerationError } from "../lyria-music";
import { generateMusic, type MusicLedger, type MusicLedgerRow } from "../music-generations";

const song = {
  steps: [
    { type: "user_input", content: [{ type: "text", text: "prompt" }] },
    {
      type: "model_output",
      content: [
        { type: "text", text: "[[B1]]\n[10.7:] Last bus leaves me by the store" },
        { type: "audio", mime_type: "audio/mpeg", data: "SUQz" },
      ],
    },
  ],
  usage: { total_output_tokens: 2650 },
};

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;
}

function memoryLedger() {
  const rows: (MusicLedgerRow & { ownerId: string; key: string; createdAt: Date })[] = [];
  const ledger: MusicLedger = {
    find: async (ownerId, key) => rows.find((r) => r.ownerId === ownerId && r.key === key) ?? null,
    countSince: async (since) =>
      rows.filter((r) => r.createdAt >= since && r.status !== "failed").length,
    reserve: async (input) => {
      if (rows.some((r) => r.ownerId === input.ownerId && r.key === input.idempotencyKey)) return null;
      const row = {
        id: crypto.randomUUID(),
        status: "pending" as const,
        promptSha256: input.promptSha256,
        ownerId: input.ownerId,
        key: input.idempotencyKey,
        createdAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    retry: async (id) => {
      const row = rows.find((r) => r.id === id)!;
      row.status = "pending";
      row.createdAt = new Date();
    },
    complete: async (id, outcome) => {
      rows.find((r) => r.id === id)!.status = outcome.status;
    },
  };
  return { ledger, rows };
}

const input = { model: "google/lyria-3.5" as const, prompt: "Warm acoustic soul", idempotencyKey: "song-1-take-1" };

describe("generateLyriaSong", () => {
  it("calls the interactions API and returns the audio and lyric map", async () => {
    const fetchImpl = fetchReturning(200, song);
    const result = await generateLyriaSong(
      { model: "google/lyria-3.5", prompt: "Warm acoustic soul" },
      { apiKey: "test-key" },
      fetchImpl,
    );
    expect(result).toEqual({
      mimeType: "audio/mpeg",
      audio: "SUQz",
      lyrics: "[[B1]]\n[10.7:] Last bus leaves me by the store",
      outputTokens: 2650,
    });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    expect(JSON.parse(String(init?.body))).toEqual({ model: "lyria-3.5", input: "Warm acoustic soul" });
  });

  it.each([
    [400, { error: { message: "Input blocked: prohibited use" } }, "MUSIC_PROMPT_REFUSED", "Input blocked: prohibited use"],
    [429, {}, "MUSIC_PROVIDER_RATE_LIMITED", undefined],
    [500, {}, "MUSIC_PROVIDER_FAILED", undefined],
    [200, { steps: [] }, "MUSIC_PROVIDER_FAILED", "The music provider returned no audio"],
  ])("maps HTTP %i to %s", async (status, body, code, message) => {
    const error = await generateLyriaSong(
      { model: "google/lyria-3.5", prompt: "x" },
      { apiKey: "k" },
      fetchReturning(status, body),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MusicGenerationError);
    expect((error as MusicGenerationError).code).toBe(code);
    if (message) expect((error as Error).message).toBe(message);
  });

  it("refuses to run without an API key", async () => {
    const fetchImpl = fetchReturning(200, song);
    await expect(
      generateLyriaSong({ model: "google/lyria-3.5", prompt: "x" }, { apiKey: "" }, fetchImpl),
    ).rejects.toMatchObject({ code: "MUSIC_NOT_CONFIGURED", status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("generateMusic", () => {
  const options = (fetchImpl: typeof fetch, dailyLimit = 5) => ({ apiKey: "k", dailyLimit, fetch: fetchImpl });

  it("records a succeeded generation with its cost", async () => {
    const { ledger, rows } = memoryLedger();
    const result = await generateMusic(ledger, "owner", input, options(fetchReturning(200, song)));
    expect(result).toMatchObject({ model: "google/lyria-3.5", costUsd: 0.08, audio: "SUQz", id: rows[0]!.id });
    expect(rows[0]!.status).toBe("succeeded");
  });

  it("does not pay twice for a reused idempotency key", async () => {
    const { ledger } = memoryLedger();
    const fetchImpl = fetchReturning(200, song);
    await generateMusic(ledger, "owner", input, options(fetchImpl));
    await expect(generateMusic(ledger, "owner", input, options(fetchImpl))).rejects.toMatchObject({
      code: "MUSIC_IDEMPOTENCY_CONFLICT",
      status: 409,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("allows a failed generation to be retried with the same key and prompt", async () => {
    const { ledger, rows } = memoryLedger();
    await expect(generateMusic(ledger, "owner", input, options(fetchReturning(500, {})))).rejects.toMatchObject({
      code: "MUSIC_PROVIDER_FAILED",
    });
    expect(rows[0]!.status).toBe("failed");
    await generateMusic(ledger, "owner", input, options(fetchReturning(200, song)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("succeeded");
  });

  it("rejects a reused key with a different prompt", async () => {
    const { ledger } = memoryLedger();
    await generateMusic(ledger, "owner", input, options(fetchReturning(500, {}))).catch(() => {});
    await expect(
      generateMusic(ledger, "owner", { ...input, prompt: "Different" }, options(fetchReturning(200, song))),
    ).rejects.toThrow("different prompt");
  });

  it("enforces the daily limit before calling the provider and ignores failures", async () => {
    const { ledger } = memoryLedger();
    await generateMusic(ledger, "owner", { ...input, idempotencyKey: "failed-take" }, options(fetchReturning(500, {}))).catch(() => {});
    await generateMusic(ledger, "owner", { ...input, idempotencyKey: "take-1" }, options(fetchReturning(200, song), 2));
    await generateMusic(ledger, "other", { ...input, idempotencyKey: "take-2" }, options(fetchReturning(200, song), 2));
    const fetchImpl = fetchReturning(200, song);
    await expect(
      generateMusic(ledger, "owner", { ...input, idempotencyKey: "take-3" }, options(fetchImpl, 2)),
    ).rejects.toMatchObject({ code: "MUSIC_DAILY_LIMIT_REACHED", status: 429 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
