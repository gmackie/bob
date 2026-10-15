import { validateApiKey } from "@gmacko/core/auth/validate-api-key";
import { extractBearerToken } from "@gmacko/ooda/api";
import { createMusicGenerationHttpResponse } from "@gmacko/ooda/api/music-http";
import { createDrizzleMusicLedger, generateMusic } from "@gmacko/ooda/kernel";
import { auth } from "~/auth/server";
import { db } from "~/lib/db-client-lazy";

/** Lyria takes about 35 s for a 3-minute song; leave headroom before giving up. */
const PROVIDER_TIMEOUT_MS = 150_000;

async function resolveOwnerId(request: Request): Promise<string | null> {
  const token =
    extractBearerToken(request.headers.get("authorization")) ||
    request.headers.get("x-api-key")?.trim() ||
    "";
  if (token) {
    const result = await validateApiKey(db as never, token, undefined, null);
    return result.ok ? result.value.userId : null;
  }
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id ?? null;
}

/**
 * POST https://ooda.blder.bot/api/v1/music/generations
 * Authorization: Bearer bob_...
 * {"model":"google/lyria-3.5","prompt":"...","idempotencyKey":"..."}
 */
export async function POST(request: Request): Promise<Response> {
  const ownerId = await resolveOwnerId(request);
  if (!ownerId) {
    return Response.json(
      {
        version: "v1",
        type: "https://ooda.local/problems/unauthorized",
        title: "Authentication required",
        status: 401,
        code: "UNAUTHORIZED",
        detail: "A valid Bob API key or OODA session is required",
        correlationId: crypto.randomUUID(),
      },
      { status: 401 },
    );
  }

  const dailyLimit = Number(process.env.OODA_MUSIC_DAILY_LIMIT ?? "25");
  return createMusicGenerationHttpResponse({
    request,
    generate: (body) =>
      generateMusic(createDrizzleMusicLedger(db as never), ownerId, body, {
        apiKey: process.env.GEMINI_API_KEY ?? "",
        dailyLimit: Number.isFinite(dailyLimit) ? dailyLimit : 25,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]),
      }),
  });
}
