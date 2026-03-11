import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getGiteaAuthUrl, type GiteaConfig } from "@linear-clone/auth";
import { stateStore } from "@/lib/auth/state-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const returnUrl = searchParams.get("returnUrl") || "/dashboard";

  const config: GiteaConfig = {
    baseUrl: process.env.GITEA_BASE_URL!,
    clientId: process.env.GITEA_CLIENT_ID!,
    clientSecret: process.env.GITEA_CLIENT_SECRET!,
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?provider=gitea`,
  };

  // Generate state for CSRF protection
  const state = randomBytes(32).toString("hex");
  stateStore.set(state, {
    returnUrl,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  const authUrl = getGiteaAuthUrl(config, state);
  return NextResponse.redirect(authUrl);
}
