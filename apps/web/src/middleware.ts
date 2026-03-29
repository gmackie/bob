import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname !== "/") {
    return NextResponse.next();
  }

  const target = request.nextUrl.clone();
  target.pathname = "/runs";

  return NextResponse.redirect(target, 302);
}

export const config = {
  matcher: ["/"],
};
