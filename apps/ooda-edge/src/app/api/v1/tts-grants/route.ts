import { createTtsGrantHttpResponse } from "@gmacko/ooda/api/tts-http";
import { createTtsGrant, resolveOodaRolloutPolicy } from "@gmacko/ooda/kernel";
import { auth } from "~/auth/server";
import { db } from "~/lib/db-client-lazy";

export async function POST(request: Request): Promise<Response> {
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

  const rollout = resolveOodaRolloutPolicy(session.user.id);
  if (!rollout.capabilities.tts) {
    return Response.json({
      version: "v1",
      type: "https://ooda.local/problems/rollout-disabled",
      title: "Voice playback is not enabled",
      status: 403,
      code: "ROLLOUT_DISABLED",
      detail: `ElevenLabs TTS is disabled at rollout stage ${rollout.stage}.`,
      correlationId: crypto.randomUUID(),
    }, { status: 403 });
  }

  return createTtsGrantHttpResponse({
    request,
    createGrant: (input, baseUrl) => createTtsGrant(
      db as never,
      session.user.id,
      input,
      {
        baseUrl,
        grantSecret: process.env.OODA_TTS_GRANT_SECRET ?? "",
        sensitiveTtsEnabled: false,
      },
    ),
  });
}
