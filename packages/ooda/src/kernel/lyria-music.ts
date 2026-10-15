/**
 * Google Lyria song generation through the Gemini Interactions API.
 * One blocking call returns base64 audio plus a timed lyric map
 * (about 35 s for a 3-minute song, measured 2026-10-15, BOB-52).
 */

export const MUSIC_MODELS = {
  "google/lyria-3.5": { upstream: "lyria-3.5", costUsdMicros: 80_000 },
} as const;

export type MusicModelId = keyof typeof MUSIC_MODELS;

export function isMusicModel(model: string): model is MusicModelId {
  return Object.hasOwn(MUSIC_MODELS, model);
}

export type MusicErrorCode =
  | "MUSIC_NOT_CONFIGURED"
  | "MUSIC_PROMPT_REFUSED"
  | "MUSIC_PROVIDER_RATE_LIMITED"
  | "MUSIC_PROVIDER_FAILED"
  | "MUSIC_DAILY_LIMIT_REACHED"
  | "MUSIC_IDEMPOTENCY_CONFLICT";

const statuses: Record<MusicErrorCode, 409 | 422 | 429 | 502 | 503> = {
  MUSIC_NOT_CONFIGURED: 503,
  MUSIC_PROMPT_REFUSED: 422,
  MUSIC_PROVIDER_RATE_LIMITED: 429,
  MUSIC_PROVIDER_FAILED: 502,
  MUSIC_DAILY_LIMIT_REACHED: 429,
  MUSIC_IDEMPOTENCY_CONFLICT: 409,
};

export class MusicGenerationError extends Error {
  readonly status: 409 | 422 | 429 | 502 | 503;

  constructor(
    readonly code: MusicErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MusicGenerationError";
    this.status = statuses[code];
  }
}

export type LyriaSong = {
  mimeType: string;
  /** Base64-encoded audio, passed through without decoding. */
  audio: string;
  /** Lyria's section and timestamp map of what it sang. */
  lyrics: string;
  outputTokens: number | null;
};

type InteractionContent = {
  type?: string;
  text?: string;
  data?: string;
  mime_type?: string;
};

type InteractionResponse = {
  steps?: { type?: string; content?: InteractionContent[] }[];
  usage?: { total_output_tokens?: number };
  error?: { message?: string };
};

export async function generateLyriaSong(
  input: { model: MusicModelId; prompt: string },
  config: { apiKey: string; signal?: AbortSignal },
  fetchImpl: typeof fetch = fetch,
): Promise<LyriaSong> {
  if (!config.apiKey) {
    throw new MusicGenerationError(
      "MUSIC_NOT_CONFIGURED",
      "Music generation is not configured on this server",
    );
  }

  let upstream: Response;
  try {
    upstream = await fetchImpl(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify({
          model: MUSIC_MODELS[input.model].upstream,
          input: input.prompt,
        }),
        signal: config.signal,
      },
    );
  } catch (error) {
    if (config.signal?.aborted) throw error;
    throw new MusicGenerationError(
      "MUSIC_PROVIDER_FAILED",
      "The music provider could not be reached",
    );
  }

  const body = (await upstream.json().catch(() => ({}))) as InteractionResponse;
  if (upstream.status === 400) {
    // Lyria rejects policy violations (artist voices, copied lyrics) up front.
    throw new MusicGenerationError(
      "MUSIC_PROMPT_REFUSED",
      body.error?.message ?? "The music provider refused the prompt",
    );
  }
  if (upstream.status === 429) {
    throw new MusicGenerationError(
      "MUSIC_PROVIDER_RATE_LIMITED",
      "The music provider is rate limiting requests; try again later",
    );
  }
  if (!upstream.ok) {
    throw new MusicGenerationError(
      "MUSIC_PROVIDER_FAILED",
      `The music provider failed with HTTP ${upstream.status}`,
    );
  }

  const content = (body.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? []);
  const audio = content.findLast((block) => block.type === "audio" && block.data);
  if (!audio?.data) {
    throw new MusicGenerationError(
      "MUSIC_PROVIDER_FAILED",
      "The music provider returned no audio",
    );
  }

  return {
    mimeType: audio.mime_type ?? "audio/mpeg",
    audio: audio.data,
    lyrics: content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n"),
    outputTokens: body.usage?.total_output_tokens ?? null,
  };
}
