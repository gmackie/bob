import { NextResponse } from "next/server";
import {
  createPublicApiCaller,
  errorResponse,
  withApiRateLimit,
} from "~/lib/rest/api-helpers";

export async function POST(request: Request) {
  return withApiRateLimit(request, async () => {
    try {
      const caller = await createPublicApiCaller(request);
      const body = (await request.json()) as Parameters<
        typeof caller.publicApi.registerWorkspace
      >[0];
      const result = await caller.publicApi.registerWorkspace(body);
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  });
}
