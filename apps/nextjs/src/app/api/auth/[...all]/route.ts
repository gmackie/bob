import { NextRequest, NextResponse } from "next/server";

import { auth } from "~/auth/server";

function maybeRedirectLegacyGitHubCallback(request: NextRequest) {
  // Back-compat for older deployments/docs that used /api/auth/github/callback.
  // Better Auth uses /api/auth/callback/github.
  if (request.nextUrl.pathname === "/api/auth/github/callback") {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    const host =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const base =
      host && host.length > 0
        ? `${proto}://${host}`
        : (process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin);

    const target = new URL("/api/auth/callback/github", base);
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target, { status: 307 });
  }
  return null;
}

export const GET = (request: NextRequest) =>
  maybeRedirectLegacyGitHubCallback(request) ?? auth.handler(request);

export const POST = (request: NextRequest) => auth.handler(request);
