import { z } from "zod/v4";

import { getSession } from "~/auth/server";
import { bizpulseConfig } from "~/server/bizpulse/client";
import {
  beginBizPulseLink,
  disconnectBizPulse,
  finishBizPulseLink,
} from "~/server/bizpulse/link";
import { checkRateLimit, rateLimitResponse } from "@bob/api/rate-limit";

type Route = { params: Promise<{ action: string }> };
const noStore = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
function redirectTo(url: string) {
  return new Response(null, {
    status: 303,
    headers: { ...noStore, Location: url },
  });
}
const settings = "/settings/bizpulse";
async function activeUser() {
  const session = await getSession();
  return session?.session && session.session.expiresAt > new Date()
    ? session.user.id
    : null;
}

export async function GET(request: Request, { params }: Route) {
  const config = bizpulseConfig();
  if (
    !config ||
    new URL(request.url).origin !== config.bobOrigin ||
    (await params).action !== "callback"
  )
    return new Response(null, { status: 404, headers: noStore });
  const limit = checkRateLimit(request, { profile: "device" });
  if (limit?.limited) return rateLimitResponse(limit);
  const userId = await activeUser();
  if (!userId) return redirectTo("/login");
  const query = new URL(request.url).searchParams;
  if (query.getAll("state").length !== 1 || query.getAll("code").length > 1)
    return redirectTo(settings + "?status=failed");
  try {
    const linked = await finishBizPulseLink(
      config,
      userId,
      query.get("state") ?? "",
      query.has("error") ? undefined : (query.get("code") ?? undefined),
    );
    return redirectTo(
      settings + (linked ? "?status=connected" : "?status=failed"),
    );
  } catch {
    return redirectTo(settings + "?status=failed");
  }
}

export async function POST(request: Request, { params }: Route) {
  const config = bizpulseConfig();
  const { action } = await params;
  if (!config || !["connect", "disconnect"].includes(action))
    return new Response(null, { status: 404 });
  if (
    request.headers.get("origin") !== config.bobOrigin ||
    new URL(request.url).origin !== config.bobOrigin
  )
    return new Response(null, { status: 403, headers: noStore });
  const limit = checkRateLimit(request, { profile: "device" });
  if (limit?.limited) return rateLimitResponse(limit);
  const userId = await activeUser();
  if (!userId) return redirectTo("/login");
  try {
    const form = await request.formData();
    const workspace = z.uuid().parse(form.get("workspace"));
    if (action === "connect")
      return redirectTo(
        (await beginBizPulseLink(config, userId, workspace)).href,
      );
    await disconnectBizPulse(config, userId, workspace);
    return redirectTo(settings + "?status=disconnected");
  } catch {
    return redirectTo(settings + "?status=failed");
  }
}
