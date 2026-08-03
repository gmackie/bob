import { NextResponse } from "next/server";
import {
  createPublicApiCaller,
  errorResponse,
  withApiRateLimit,
} from "~/lib/rest/api-helpers";

// POST /api/v1/projects — create a (linear-clone) project + seed backlog tasks.
// The OODA "Make it a project" path. Auth + rate limiting come from the shared
// public-API helpers; the create-gmacko-app scaffold is a separate call to
// /api/v1/dispatch by the caller.
export async function POST(request: Request) {
  return withApiRateLimit(request, async () => {
    try {
      const caller = await createPublicApiCaller(request);
      const body = (await request.json()) as Parameters<
        typeof caller.publicApi.createProject
      >[0];
      const result = await caller.publicApi.createProject(body);
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  });
}
