import { NextResponse, type NextRequest } from "next/server";

import { db } from "@bob/db/client";
import { eq, and } from "@bob/db";
import { tenantMembers } from "@bob/db/schema";
import { auth, getSession } from "~/auth/server";

export const GET = (request: NextRequest, _ctx: { params: Promise<{ all: string[] }> }) =>
  auth.handler(request);

// Registering an SSO identity provider is an operator action. Better-auth's
// /sso/register only requires a session, so gate it here: the caller must own a
// tenant. Everything else falls straight through to better-auth.
export async function POST(request: NextRequest, _ctx: { params: Promise<{ all: string[] }> }) {
  if (request.nextUrl.pathname.endsWith("/sso/register")) {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const [owner] = await db
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.userId, session.user.id), eq(tenantMembers.role, "owner")))
      .limit(1);
    if (!owner) {
      return NextResponse.json(
        { error: "Only a tenant owner can register an SSO provider" },
        { status: 403 },
      );
    }
  }
  return auth.handler(request);
}
