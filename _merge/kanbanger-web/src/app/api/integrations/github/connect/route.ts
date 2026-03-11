import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const returnUrl = searchParams.get("returnUrl") || "/dashboard/settings";

  const state = crypto.randomBytes(32).toString("hex");
  
  const cookieStore = await cookies();
  cookieStore.set("github_connect_state", JSON.stringify({ state, returnUrl }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/github/connect/callback`,
    scope: "user:email repo read:org admin:repo_hook",
    state,
  });

  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`);
}
