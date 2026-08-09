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
      const idempotencyKey = request.headers.get("idempotency-key");
      if (!idempotencyKey || idempotencyKey !== body.idempotencyKey) {
        return NextResponse.json(
          { error: "Idempotency-Key must match the approved intake payload" },
          { status: 400 },
        );
      }
      const result = await caller.publicApi.createProject(body);
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  });
}

// GET /api/v1/projects?workspaceId=… — list a workspace's projects.
export async function GET(request: Request) {
  return withApiRateLimit(request, async () => {
    try {
      const caller = await createPublicApiCaller(request);
      const workspaceId =
        new URL(request.url).searchParams.get("workspaceId") ?? "";
      const result = await caller.publicApi.listProjects({ workspaceId });
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  });
}
