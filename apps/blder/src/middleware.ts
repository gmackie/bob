import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function isEmergencyDisabled(): boolean {
  const value = process.env.BOB_EMERGENCY_DISABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function isEmergencyAllowedPath(pathname: string): boolean {
  return (
    pathname === "/support/emergency-disabled" ||
    pathname === "/api/support/status" ||
    pathname === "/api/trpc/support.model" ||
    pathname === "/api/trpc/system.health" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

export function middleware(request: NextRequest) {
  if (
    isEmergencyDisabled() &&
    !isEmergencyAllowedPath(request.nextUrl.pathname)
  ) {
    const target = new URL("/support/emergency-disabled", request.url);
    return NextResponse.redirect(target, 302);
  }

  if (request.nextUrl.pathname !== "/") {
    return NextResponse.next();
  }
  const target = new URL("/runs", request.url);
  return NextResponse.redirect(target, 302);
}

export const config = {
  matcher: ["/((?!.*\\..*).*)", "/api/:path*"],
};
