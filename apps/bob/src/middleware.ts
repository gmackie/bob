import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
  matcher: ["/", "/v1/:path*"],
};
