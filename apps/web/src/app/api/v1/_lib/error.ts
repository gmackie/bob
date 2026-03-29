import { NextResponse } from "next/server";
import { TRPCError } from "@trpc/server";

const STATUS_MAP: Record<string, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  PARSE_ERROR: 400,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
};

export function errorResponse(error: unknown) {
  if (error instanceof TRPCError) {
    const status = STATUS_MAP[error.code] ?? 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  const message =
    error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json({ error: message }, { status: 500 });
}
