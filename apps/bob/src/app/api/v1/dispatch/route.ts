import { NextResponse } from "next/server";
import {
  createPublicApiCaller,
  errorResponse,
  withApiRateLimit,
} from "~/lib/rest/api-helpers";

// POST /api/v1/dispatch — create an EXECUTABLE session (OODA -> Bob, Phase 5 M1).
// Auth + rate limiting come from the shared public-API helpers; the underlying
// publicApi.dispatchExecution stays gated behind BOB_OODA_DISPATCH_ENABLED, so
// this route returns 403 until executable dispatch is deliberately enabled.
export async function POST(request: Request) {
  return withApiRateLimit(request, async () => {
    try {
      const caller = await createPublicApiCaller(request);
      const body = (await request.json()) as Parameters<
        typeof caller.publicApi.dispatchExecution
      >[0];
      const result = await caller.publicApi.dispatchExecution(body);
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  });
}
