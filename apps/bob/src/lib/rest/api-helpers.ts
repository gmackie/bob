import { NextResponse } from "next/server";
import { TRPCError } from "@trpc/server";
import { createTRPCContext } from "@bob/api";
import { edgeRouter } from "~/lib/edge-router";
import { authBundle } from "~/auth/server";

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
    if (status >= 500) {
      const chain: Array<Record<string, unknown>> = [];
      let cur: unknown = error;
      let depth = 0;
      while (cur && depth < 6) {
        if (cur instanceof Error) {
          chain.push({
            name: cur.name,
            message: cur.message,
            ...(("code" in cur) && { code: (cur as { code?: unknown }).code }),
            ...(("severity" in cur) && { severity: (cur as { severity?: unknown }).severity }),
            ...(("detail" in cur) && { detail: (cur as { detail?: unknown }).detail }),
            ...(("constraint" in cur) && { constraint: (cur as { constraint?: unknown }).constraint }),
            stack: cur.stack?.split("\n").slice(0, 4).join("\n"),
          });
          cur = (cur as { cause?: unknown }).cause;
        } else {
          chain.push({ value: cur });
          break;
        }
        depth++;
      }
      console.error("[rest-api] TRPCError 500", { code: error.code, chain });
    }
    return NextResponse.json({ error: error.message }, { status });
  }
  const message =
    error instanceof Error ? error.message : "Internal server error";
  console.error("[rest-api] unhandled error", {
    message,
    name: error instanceof Error ? error.name : undefined,
    cause: error instanceof Error && error.cause instanceof Error
      ? { name: error.cause.name, message: error.cause.message }
      : undefined,
    stack: error instanceof Error ? error.stack?.split("\n").slice(0, 5).join("\n") : undefined,
  });
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function createPublicApiCaller(request: Request) {
  const ctx = await createTRPCContext({
    headers: request.headers,
    authBundle,
  });
  return edgeRouter.createCaller(ctx);
}
