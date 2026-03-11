import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicRoutes = [
  "/",
  "/login",
  "/auth/callback",
  "/api/auth",
  "/api/webhooks",
  "/api/health",
];

const BETA_AUTH_BYPASS = process.env.BETA_AUTH_BYPASS === "true";
const BETA_TEST_USER_ID = process.env.BETA_TEST_USER_ID ?? "00000000-0000-0000-0000-000000000001";

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  if (isPublicRoute) {
    return NextResponse.next();
  }

  if (BETA_AUTH_BYPASS) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-beta-user-id", BETA_TEST_USER_ID);
    requestHeaders.set("x-beta-auth-bypass", "true");
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    response.cookies.set("beta_auth_bypass", "true", { path: "/" });
    response.cookies.set("beta_user_id", BETA_TEST_USER_ID, { path: "/" });
    return response;
  }

  const sessionToken = request.cookies.get("session_token")?.value;

  if (!sessionToken && !pathname.startsWith("/api/")) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
