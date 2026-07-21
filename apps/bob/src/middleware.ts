import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_API_CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "86400",
} as const;

function withPublicApiCors(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(PUBLIC_API_CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    const response =
      request.method === "OPTIONS"
        ? new NextResponse(null, { status: 204 })
        : NextResponse.next();
    return withPublicApiCors(response);
  }

  if (pathname.startsWith("/v1/")) {
    const rewritten = new URL(`/api${pathname}`, request.url);
    rewritten.search = request.nextUrl.search;
    return NextResponse.rewrite(rewritten);
  }

  if (pathname === "/") {
    return NextResponse.redirect(new URL("/runs", request.url), 302);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/v1/:path*", "/api/v1/:path*"],
};
