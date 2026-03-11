import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, users } from "@linear-clone/db";
import { validateSession } from "@linear-clone/auth";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  const cookieStore = await cookies();
  const stateDataRaw = cookieStore.get("github_connect_state")?.value;
  
  if (!stateDataRaw) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?error=invalid_state`
    );
  }

  const stateData = JSON.parse(stateDataRaw) as { state: string; returnUrl: string };
  cookieStore.delete("github_connect_state");

  if (error) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}${stateData.returnUrl}?error=${encodeURIComponent(errorDescription || error)}`
    );
  }

  if (!code || !state || state !== stateData.state) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}${stateData.returnUrl}?error=invalid_state`
    );
  }

  const sessionToken = cookieStore.get("session_token")?.value;
  if (!sessionToken) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/auth/login?returnUrl=${encodeURIComponent(stateData.returnUrl)}`
    );
  }

  const session = await validateSession(db, sessionToken);
  if (!session.valid || !session.user) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/auth/login?returnUrl=${encodeURIComponent(stateData.returnUrl)}`
    );
  }

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenResponse.json() as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}${stateData.returnUrl}?error=${encodeURIComponent(tokenData.error_description || tokenData.error || "token_exchange_failed")}`
      );
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github+json",
      },
    });

    const githubUser = await userResponse.json() as {
      id: number;
      login: string;
      avatar_url: string;
    };

    await db
      .update(users)
      .set({
        githubId: String(githubUser.id),
        githubUsername: githubUser.login,
        githubAccessToken: tokenData.access_token,
        avatarUrl: session.user.avatarUrl || githubUser.avatar_url,
        updatedAt: new Date(),
      })
      .where(eq(users.id, session.user.id));

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}${stateData.returnUrl}?github_connected=true`
    );
  } catch (err) {
    console.error("GitHub connect error:", err);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}${stateData.returnUrl}?error=connection_failed`
    );
  }
}
