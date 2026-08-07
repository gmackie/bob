import { createTtsGrantHttpResponse } from "@gmacko/ooda/api/tts-http";
import { db } from "@gmacko/ooda/db/client";
import { createTtsGrant } from "@gmacko/ooda/kernel";
import { auth } from "~/auth/server";

export const dynamic = "force-dynamic";

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

  return createTtsGrantHttpResponse({
    request,
    createGrant: (input, baseUrl) => createTtsGrant(db, session.user.id, input, {
      baseUrl,
      grantSecret: process.env.OODA_TTS_GRANT_SECRET ?? "",
      sensitiveTtsEnabled: false,
    }),
  });
}
