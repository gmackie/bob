import { z } from "zod/v4";
import { checkRateLimit, rateLimitResponse } from "@bob/api/rate-limit";

import { getSession } from "~/auth/server";
import { llaveroConfig } from "~/server/llavero/client";
import {
  beginLlaveroLink,
  disconnectLlavero,
  finishLlaveroLink,
  verifyLlaveroLink,
} from "~/server/llavero/link";

type Route = { params: Promise<{ action: string }> };
const settings = "/settings/llavero";
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
function redirectTo(url: string) {
  return new Response(null, { status: 303, headers: { ...noStore, Location: url } });
}
async function activeUser() {
  const session = await getSession();
  return session?.session && session.session.expiresAt > new Date()
    ? session.user.id
    : null;
}

export async function GET(request: Request, { params }: Route) {
  const config = llaveroConfig();
  const url = new URL(request.url);
  if (!config || url.origin !== config.bobOrigin || (await params).action !== "callback")
    return new Response(null, { status: 404, headers: noStore });
  const limit = checkRateLimit(request, { profile: "device" });
  if (limit?.limited) return rateLimitResponse(limit);
  const userId = await activeUser();
  if (!userId) return redirectTo("/login");
  const query = url.searchParams;
  if (query.getAll("state").length !== 1 || query.getAll("code").length > 1)
    return redirectTo(settings + "?status=failed");
  try {
    const connected = await finishLlaveroLink(
      config,
      userId,
      query.get("state") ?? "",
      query.has("error") ? undefined : (query.get("code") ?? undefined),
    );
    return redirectTo(settings + (connected ? "?status=connected" : "?status=failed"));
  } catch {
    return redirectTo(settings + "?status=failed");
  }
}

export async function POST(request: Request, { params }: Route) {
  const config = llaveroConfig();
  const { action } = await params;
  if (!config || !["connect", "disconnect", "check"].includes(action))
    return new Response(null, { status: 404, headers: noStore });
  if (request.headers.get("origin") !== config.bobOrigin || new URL(request.url).origin !== config.bobOrigin)
    return new Response(null, { status: 403, headers: noStore });
  const limit = checkRateLimit(request, { profile: "device" });
  if (limit?.limited) return rateLimitResponse(limit);
  const userId = await activeUser();
  if (!userId) return redirectTo("/login");
  try {
    const workspaceId = z.uuid().parse((await request.formData()).get("workspace"));
    if (action === "connect")
      return redirectTo((await beginLlaveroLink(config, userId, workspaceId)).href);
    if (action === "check") {
      const accessible = await verifyLlaveroLink(config, userId, workspaceId);
      return redirectTo(settings + (accessible ? "?status=verified" : "?status=failed"));
    }
    const revoked = await disconnectLlavero(config, userId, workspaceId);
    return redirectTo(settings + (revoked ? "?status=disconnected" : "?status=revocation-required"));
  } catch {
    return redirectTo(settings + "?status=failed");
  }
}
