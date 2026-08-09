export type ElevenLabsTtsConfig = {
  apiKey: string;
  voiceId: string;
  modelId?: string;
  outputFormat?: string;
  signal?: AbortSignal;
};

export class ElevenLabsTtsError extends Error {
  readonly status = 502;

  constructor(message = "The text-to-speech provider rejected the stream request") {
    super(message);
    this.name = "ElevenLabsTtsError";
  }
}

export async function streamElevenLabsTts(
  text: string,
  config: ElevenLabsTtsConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!config.apiKey || !config.voiceId) {
    throw new ElevenLabsTtsError("Text-to-speech provider configuration is incomplete");
  }

  const endpoint = new URL(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream`,
  );
  endpoint.searchParams.set("enable_logging", "false");
  endpoint.searchParams.set("output_format", config.outputFormat ?? "mp3_44100_128");

  const upstream = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      accept: "audio/mpeg",
      "content-type": "application/json",
      "xi-api-key": config.apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: config.modelId ?? "eleven_flash_v2_5",
    }),
    signal: config.signal,
  });

  if (!upstream.ok || !upstream.body) {
    throw new ElevenLabsTtsError();
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "x-content-type-options": "nosniff",
    },
  });
}
