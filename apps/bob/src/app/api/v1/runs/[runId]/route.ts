import { NextResponse } from "next/server";
import {
  createPublicApiCaller,
  errorResponse,
  withApiRateLimit,
} from "~/lib/rest/api-helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  return withApiRateLimit(request, async () => {
    try {
      const { runId } = await params;
      const caller = await createPublicApiCaller(request);
      const result = await caller.publicApi.getRun({ runId });
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  return withApiRateLimit(request, async () => {
    try {
      const { runId } = await params;
      const caller = await createPublicApiCaller(request);
      const body = (await request.json()) as Record<string, unknown>;
      const result = await caller.publicApi.updateRun({
        runId,
        ...body,
      } as Parameters<typeof caller.publicApi.updateRun>[0]);
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  });
}
