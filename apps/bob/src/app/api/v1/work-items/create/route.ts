import { NextResponse } from "next/server";
import {
  createPublicApiCaller,
  errorResponse,
  withApiRateLimit,
} from "~/lib/rest/api-helpers";

// POST /api/v1/work-items/create — create a single task, optionally under a
// project. Used by the OODA conversation agent's Kanbanger tool.
export async function POST(request: Request) {
  return withApiRateLimit(request, async () => {
    try {
      const caller = await createPublicApiCaller(request);
      const body = (await request.json()) as Parameters<
        typeof caller.publicApi.createWorkItem
      >[0];
      const result = await caller.publicApi.createWorkItem(body);
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  });
}
