import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import {
  exchangeGitHubCode,
  getGitHubUserInfo,
  getGitHubPrimaryEmail,
  createSession,
  type GitHubConfig,
} from "@linear-clone/auth";
import { db, users } from "@linear-clone/db";
import { stateStore } from "@/lib/auth/state-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    return NextResponse.json(
      { error: errorDescription || error },
      { status: 400 }
    );
  }

  if (!code || !state) {
    return NextResponse.json(
      { error: "Missing code or state" },
      { status: 400 }
    );
  }

  // Validate state
  const stateData = stateStore.get(state);
  if (!stateData || stateData.expiresAt < Date.now()) {
    stateStore.delete(state);
    return NextResponse.json(
      { error: "Invalid or expired state" },
      { status: 400 }
    );
  }
  stateStore.delete(state);

  const config: GitHubConfig = {
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?provider=github`,
  };

  try {
    // Exchange code for tokens
    const tokens = await exchangeGitHubCode(config, code);

    // Get user info
    const userInfo = await getGitHubUserInfo(tokens.access_token);
    const email = userInfo.email || (await getGitHubPrimaryEmail(tokens.access_token));

    if (!email) {
      return NextResponse.json(
        { error: "Could not retrieve email from GitHub" },
        { status: 400 }
      );
    }

    // Find or create user
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.githubId, String(userInfo.id)))
      .limit(1);

    if (!user) {
      // Check if user exists with this email
      [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (user) {
        // Link GitHub ID to existing user
        await db
          .update(users)
          .set({
            githubId: String(userInfo.id),
            githubUsername: userInfo.login,
            avatarUrl: userInfo.avatar_url,
          })
          .where(eq(users.id, user.id));
      } else {
        // Create new user
        const [newUser] = await db
          .insert(users)
          .values({
            email,
            name: userInfo.name || userInfo.login,
            githubId: String(userInfo.id),
            githubUsername: userInfo.login,
            avatarUrl: userInfo.avatar_url,
          })
          .returning();
        user = newUser!;
      }
    }

    if (!user) {
      throw new Error("Failed to find or create user");
    }

    // Create session
    const { sessionToken, expiresAt } = await createSession(
      db,
      user.id,
      request.headers.get("user-agent") || undefined,
      request.headers.get("x-forwarded-for")?.split(",")[0] || undefined
    );

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set("session_token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: expiresAt,
      path: "/",
    });

    return NextResponse.json({
      success: true,
      returnUrl: stateData.returnUrl,
    });
  } catch (err) {
    console.error("GitHub callback error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Authentication failed" },
      { status: 500 }
    );
  }
}
