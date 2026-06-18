import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SESSION_COOKIE = "better-auth.session_token";
const SESSION_COOKIE_ALT = "session";

export function middleware(req: NextRequest) {
  const token =
    req.cookies.get(SESSION_COOKIE)?.value ??
    req.cookies.get(SESSION_COOKIE_ALT)?.value ??
    extractBearer(req.headers.get("authorization"));

  if (!token) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  return NextResponse.next();
}

function extractBearer(auth: string | null): string | null {
  if (!auth) return null;
  const trimmed = auth.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  return trimmed.slice(7).trim() || null;
}

export const config = {
  matcher: ["/api/buddy/:path*", "/api/runner/:path*"],
};
