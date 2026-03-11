import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getEntraAuthUrl, type EntraConfig } from "@linear-clone/auth";
import { stateStore } from "@/lib/auth/state-store";

function getBaseUrl(request: Request): string {
  // Try server-side env var first, then construct from request
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;

  // Construct from request headers
  const host = request.headers.get("host") || "tasks.gmac.io";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const returnUrl = searchParams.get("returnUrl") || "/dashboard";
  const baseUrl = getBaseUrl(request);

  const config: EntraConfig = {
    clientId: process.env.ENTRA_CLIENT_ID!,
    clientSecret: process.env.ENTRA_CLIENT_SECRET!,
    tenantId: process.env.ENTRA_TENANT_ID!,
    redirectUri: `${baseUrl}/api/auth/entra/callback`,
  };

  // Generate state for CSRF protection
  const state = randomBytes(32).toString("hex");
  stateStore.set(state, {
    returnUrl,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  const authUrl = getEntraAuthUrl(config, state);
  return NextResponse.redirect(authUrl);
}
