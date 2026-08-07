import { NextResponse } from "next/server";
import {
  createPublicApiCaller,
  errorResponse,
  withApiRateLimit,
} from "~/lib/rest/api-helpers";

export async function GET(request: Request) {
  return withApiRateLimit(request, async () => {
    try {
      const caller = await createPublicApiCaller(request);
      const url = new URL(request.url);
      return NextResponse.json(
        await caller.publicApi.lookupIntake({
          workspaceId: url.searchParams.get("workspaceId") ?? "",
          idempotencyKey: url.searchParams.get("idempotencyKey") ?? "",
        }),
      );
    } catch (error) {
      return errorResponse(error);
    }
  });
}
