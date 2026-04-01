import { NextResponse } from "next/server";
import { createPublicApiCaller, errorResponse } from "~/lib/rest/api-helpers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const caller = await createPublicApiCaller(request);
    const result = await caller.publicApi.getRun({ runId });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const caller = await createPublicApiCaller(request);
    const body = await request.json();
    const result = await caller.publicApi.updateRun({ runId, ...body });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
