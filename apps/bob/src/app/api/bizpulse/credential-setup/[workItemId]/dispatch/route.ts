import { and, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { workItems } from "@bob/db/schema";
import { BIZPULSE_CREDENTIAL_SETUP } from "@bob/api/handlers/workItems";
import { checkRateLimit, rateLimitResponse } from "@bob/api/rate-limit";
import { z } from "zod/v4";

import { auth } from "~/auth/server";
import { bizpulseConfig } from "~/server/bizpulse/client";
import { makeCredentialSetup } from "~/server/bizpulse/credential-setup";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workItemId: string }> },
) {
  const config = bizpulseConfig();
  if (!config) return new Response(null, { status: 404 });
  if (request.headers.get("origin") !== config.bobOrigin ||
      new URL(request.url).origin !== config.bobOrigin)
    return new Response(null, { status: 403 });
  const limit = checkRateLimit(request, { profile: "device" });
  if (limit?.limited) return rateLimitResponse(limit);
  const cookie = request.headers.get("cookie");
  const session = cookie && await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session || session.session.expiresAt <= new Date())
    return new Response(null, { status: 401 });
  const id = z.uuid().safeParse((await params).workItemId);
  if (!id.success) return new Response(null, { status: 404 });
  const item = await db.query.workItems.findFirst({
    where: and(
      eq(workItems.id, id.data),
      eq(workItems.ownerUserId, session.user.id),
      eq(workItems.externalProvider, BIZPULSE_CREDENTIAL_SETUP),
    ),
    columns: { workspaceId: true },
  });
  if (!item?.workspaceId) return new Response(null, { status: 404 });

  const destination = new URL(`/work-items/${id.data}`, config.bobOrigin);
  try {
    await makeCredentialSetup(db).approveAndDispatch(
      { userId: session.user.id, workspaceId: item.workspaceId },
      id.data,
    );
    destination.searchParams.set("credentialDispatch", "requested");
  } catch {
    destination.searchParams.set("credentialDispatch", "check");
  }
  return new Response(null, {
    status: 303,
    headers: { "Cache-Control": "no-store", Location: destination.href },
  });
}
