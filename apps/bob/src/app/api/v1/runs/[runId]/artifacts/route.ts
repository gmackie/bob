import { NextResponse } from "next/server";
import { createPublicApiCaller, errorResponse } from "~/lib/rest/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const caller = await createPublicApiCaller(request);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await caller.publicApi.createArtifact({ runId, ...body } as Parameters<typeof caller.publicApi.createArtifact>[0]);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
