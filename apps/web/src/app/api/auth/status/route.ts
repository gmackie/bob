import { type NextRequest, NextResponse } from "next/server";
import { validateSessionToken } from "@bob/auth";

import { auth } from "~/auth/server";

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

export async function GET(request: NextRequest): Promise<NextResponse<AuthStatusResponse>> {
  const requireAuth = process.env.REQUIRE_AUTH === "true";

  // If auth is not required, treat all users as "authenticated" so the UI
  // can proceed without an auth token.
  if (!requireAuth) {
    return NextResponse.json({
      authenticated: true,
      user: { id: "local", username: "local" },
    });
  }

  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (session?.user) {
    return NextResponse.json({
      authenticated: true,
      user: {
        id: session.user.id,
        username: session.user.email?.split("@")[0] ?? session.user.id,
        displayName: session.user.name,
        email: session.user.email,
        avatarUrl: session.user.image ?? undefined,
      },
    });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  const validated = await validateSessionToken(token);

  if (!validated) {
    return NextResponse.json({ authenticated: false, user: null }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: validated.user.id,
      username: validated.user.email?.split("@")[0] ?? validated.user.id,
      displayName: validated.user.name,
      email: validated.user.email,
      avatarUrl: validated.user.image ?? undefined,
    },
  });
}
