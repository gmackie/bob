import { z, ZodError } from "zod";

import {
  isMusicModel,
  MUSIC_MODELS,
  MusicGenerationError,
  type MusicModelId,
} from "../kernel/lyria-music";
import type { GenerateMusicInput, GenerateMusicResult } from "../kernel/music-generations";

export const GenerateMusicInputV1Schema = z.object({
  model: z
    .string()
    .refine(isMusicModel, { message: `model must be one of ${Object.keys(MUSIC_MODELS).join(", ")}` })
    .transform((model) => model as MusicModelId),
  prompt: z.string().trim().min(1).max(8_000),
  idempotencyKey: z.string().trim().min(8).max(200),
});

function problem(status: number, code: string, title: string, detail: string): Response {
  return Response.json(
    {
      version: "v1",
      type: `https://ooda.local/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title,
      status,
      code,
      detail,
      correlationId: crypto.randomUUID(),
    },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * POST /api/v1/music/generations — body {model, prompt, idempotencyKey}.
 * Returns the audio inline as base64 with Lyria's timed lyric map.
 */
export async function createMusicGenerationHttpResponse(input: {
  request: Request;
  generate: (body: GenerateMusicInput) => Promise<GenerateMusicResult>;
}): Promise<Response> {
  let body: GenerateMusicInput;
  try {
    body = GenerateMusicInputV1Schema.parse(await input.request.json());
  } catch (error) {
    const detail =
      error instanceof ZodError
        ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : "The request body must be JSON";
    return problem(422, "VALIDATION_FAILED", "Invalid request", detail);
  }

  try {
    const result = await input.generate(body);
    return Response.json(
      {
        id: result.id,
        model: result.model,
        mimeType: result.mimeType,
        audio: result.audio,
        lyrics: result.lyrics,
        costUsd: result.costUsd,
        usage: { outputTokens: result.outputTokens },
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MusicGenerationError) {
      return problem(error.status, error.code, "Music generation failed", error.message);
    }
    return problem(500, "INTERNAL_ERROR", "Internal error", "The music request could not be completed");
  }
}
