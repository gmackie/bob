import { NextResponse } from "next/server";

type AuthStatusResponse =
  | {
      authenticated: true;
      user: {
        id: string;
        username: string;
        displayName?: string;
        email?: string;
        avatarUrl?: string;
      };
    }
  | {
      authenticated: false;
      user: null;
    };

export async function GET(request: Request): Promise<NextResponse<AuthStatusResponse>> {
  const requireAuth = process.env.REQUIRE_AUTH === "true";

  // If auth is not required, treat all users as "authenticated" so the UI
  // can proceed without an auth token.
  if (!requireAuth) {
    return NextResponse.json({
      authenticated: true,
      user: { id: "local", username: "local" },
    });
  }

  const auth = request.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];

  if (!token) {
    return NextResponse.json({ authenticated: false, user: null }, { status: 401 });
  }

  // TODO: wire real token validation (better-auth) when REQUIRE_AUTH is enabled.
  return NextResponse.json({
    authenticated: true,
    user: { id: "token", username: "token" },
  });
}
