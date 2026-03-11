import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import {
  exchangeEntraCode,
  getEntraUserInfo,
  validateEntraDomain,
  createSession,
  type EntraConfig,
} from "@linear-clone/auth";
import { db, users } from "@linear-clone/db";
import { stateStore } from "@/lib/auth/state-store";

function getBaseUrl(request: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const host = request.headers.get("host") || "tasks.gmac.io";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  const baseUrl = getBaseUrl(request);

  if (error) {
    const errorUrl = new URL("/login", baseUrl);
    errorUrl.searchParams.set("error", errorDescription || error);
    return NextResponse.redirect(errorUrl.toString());
  }

  if (!code || !state) {
    const errorUrl = new URL("/login", baseUrl);
    errorUrl.searchParams.set("error", "Missing authorization code");
    return NextResponse.redirect(errorUrl.toString());
  }

  // Validate state
  const stateData = stateStore.get(state);
  if (!stateData || stateData.expiresAt < Date.now()) {
    stateStore.delete(state);
    const errorUrl = new URL("/login", baseUrl);
    errorUrl.searchParams.set("error", "Session expired, please try again");
    return NextResponse.redirect(errorUrl.toString());
  }
  stateStore.delete(state);

  const config: EntraConfig = {
    clientId: process.env.ENTRA_CLIENT_ID!,
    clientSecret: process.env.ENTRA_CLIENT_SECRET!,
    tenantId: process.env.ENTRA_TENANT_ID!,
    redirectUri: `${baseUrl}/api/auth/entra/callback`,
  };

  try {
    // Exchange code for tokens
    const tokens = await exchangeEntraCode(config, code);

    // Get user info
    const userInfo = await getEntraUserInfo(tokens.access_token);
    const email = userInfo.mail || userInfo.userPrincipalName;

    // Validate domain
    if (!validateEntraDomain(email)) {
      return NextResponse.json(
        { error: "Only @gmacko.com accounts are allowed" },
        { status: 403 }
      );
    }

    // Find or create user
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.entraId, userInfo.id))
      .limit(1);

    if (!user) {
      // Check if user exists with this email
      [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (user) {
        // Link Entra ID to existing user
        await db
          .update(users)
          .set({
            entraId: userInfo.id,
            name: userInfo.displayName,
          })
          .where(eq(users.id, user.id));
      } else {
        // Create new user
        const [newUser] = await db
          .insert(users)
          .values({
            email,
            name: userInfo.displayName,
            entraId: userInfo.id,
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

    const isMobileCallback = stateData.returnUrl.includes("/api/auth/mobile-callback");
    
    if (isMobileCallback) {
      const mobileRedirectUrl = new URL(stateData.returnUrl, baseUrl);
      mobileRedirectUrl.searchParams.set("session_token", sessionToken);
      return NextResponse.redirect(mobileRedirectUrl.toString());
    }

    const cookieStore = await cookies();
    cookieStore.set("session_token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: expiresAt,
      path: "/",
    });

    // Redirect to the return URL
    const redirectUrl = new URL(stateData.returnUrl, baseUrl);
    return NextResponse.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("Entra callback error:", err);
    const errorUrl = new URL("/login", baseUrl);
    errorUrl.searchParams.set("error", err instanceof Error ? err.message : "Authentication failed");
    return NextResponse.redirect(errorUrl.toString());
  }
}
