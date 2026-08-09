import { ZodError } from "zod";

import {
  CreateTtsGrantInputV1Schema,
  type CreateTtsGrantInputV1,
  type CreateTtsGrantResultV1,
} from "../contracts/v1";
import { ElevenLabsTtsError } from "../kernel/elevenlabs-tts";
import { OodaKernelProblem } from "../kernel/problems";

function problem(
  status: number,
  code: string,
  title: string,
  detail: string,
): Response {
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

function errorResponse(error: unknown): Response {
  if (error instanceof OodaKernelProblem) {
    return problem(error.status, error.code, "Text-to-speech request rejected", error.message);
  }
  if (error instanceof ZodError) {
    return problem(422, "VALIDATION_FAILED", "Invalid request", "The TTS grant request is malformed");
  }
  if (error instanceof ElevenLabsTtsError) {
    return problem(502, "TTS_PROVIDER_FAILED", "Text-to-speech provider failed", error.message);
  }
  return problem(500, "INTERNAL_ERROR", "Internal error", "The TTS request could not be completed");
}

export async function createTtsGrantHttpResponse(input: {
  request: Request;
  createGrant: (
    grant: CreateTtsGrantInputV1,
    baseUrl: string,
  ) => Promise<CreateTtsGrantResultV1>;
}): Promise<Response> {
  try {
    const body = CreateTtsGrantInputV1Schema.parse(await input.request.json());
    const result = await input.createGrant(body, new URL(input.request.url).origin);
    return Response.json(result, {
      status: result.replayed ? 200 : 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function createTtsStreamHttpResponse(input: {
  token: string;
  consumeGrant: (token: string) => Promise<{ text: string; grantId: string }>;
  streamSpeech: (text: string) => Promise<Response>;
}): Promise<Response> {
  if (input.token.length < 16 || input.token.length > 512) {
    return problem(410, "TTS_GRANT_UNAVAILABLE", "TTS grant unavailable", "The TTS grant is invalid, expired, or already used");
  }

  try {
    const grant = await input.consumeGrant(input.token);
    return await input.streamSpeech(grant.text);
  } catch (error) {
    return errorResponse(error);
  }
}
