import { createTtsStreamHttpResponse } from "@gmacko/ooda/api/tts-http";
import { db } from "@gmacko/ooda/db/client";
import { consumeTtsGrant, streamElevenLabsTts } from "@gmacko/ooda/kernel";
import { auth } from "~/auth/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return Response.json({
      version: "v1",
      type: "https://ooda.local/problems/unauthorized",
      title: "Authentication required",
      status: 401,
      code: "UNAUTHORIZED",
      detail: "A valid OODA session is required",
      correlationId: crypto.randomUUID(),
    }, { status: 401 });
  }

  const { token } = await context.params;
  return createTtsStreamHttpResponse({
    token,
    consumeGrant: (value) => consumeTtsGrant(db, session.user.id, value),
    streamSpeech: (text) => streamElevenLabsTts(text, {
      apiKey: process.env.ELEVENLABS_API_KEY ?? "",
      voiceId: process.env.ELEVENLABS_VOICE_ID ?? "",
      modelId: process.env.ELEVENLABS_TTS_MODEL,
      outputFormat: process.env.ELEVENLABS_TTS_OUTPUT_FORMAT,
      signal: request.signal,
    }),
  });
}
