import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getGitHubAuthUrl, type GitHubConfig } from "@linear-clone/auth";
import { stateStore } from "@/lib/auth/state-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const returnUrl = searchParams.get("returnUrl") || "/dashboard";

  const config: GitHubConfig = {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?provider=github`,
  };

  // Generate state for CSRF protection
  const state = randomBytes(32).toString("hex");
  stateStore.set(state, {
    returnUrl,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  const authUrl = getGitHubAuthUrl(config, state);
  return NextResponse.redirect(authUrl);
}
