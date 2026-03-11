import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, users } from "@linear-clone/db";
import { validateSession } from "@linear-clone/auth";

const GITEA_URL = process.env.GITEA_URL || "https://git.gmac.io";
const GITEA_CLIENT_ID = process.env.GITEA_CLIENT_ID!;
const GITEA_CLIENT_SECRET = process.env.GITEA_CLIENT_SECRET!;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  const cookieStore = await cookies();
  const stateDataRaw = cookieStore.get("gitea_connect_state")?.value;
  
  if (!stateDataRaw) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?error=invalid_state`
    );
  }

  const stateData = JSON.parse(stateDataRaw) as { state: string; returnUrl: string };
  cookieStore.delete("gitea_connect_state");

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
    const tokenParams = new URLSearchParams({
      client_id: GITEA_CLIENT_ID,
      client_secret: GITEA_CLIENT_SECRET,
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/gitea/connect/callback`,
      grant_type: "authorization_code",
    });

    const tokenResponse = await fetch(`${GITEA_URL}/login/oauth/access_token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenParams.toString(),
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

    const userResponse = await fetch(`${GITEA_URL}/api/v1/user`, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/json",
      },
    });

    const giteaUser = await userResponse.json() as {
      id: number;
      login: string;
      avatar_url: string;
    };

    await db
      .update(users)
      .set({
        giteaId: String(giteaUser.id),
        giteaUsername: giteaUser.login,
        giteaAccessToken: tokenData.access_token,
        avatarUrl: session.user.avatarUrl || giteaUser.avatar_url,
        updatedAt: new Date(),
      })
      .where(eq(users.id, session.user.id));

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}${stateData.returnUrl}?gitea_connected=true`
    );
  } catch (err) {
    console.error("Gitea connect error:", err);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}${stateData.returnUrl}?error=connection_failed`
    );
  }
}
