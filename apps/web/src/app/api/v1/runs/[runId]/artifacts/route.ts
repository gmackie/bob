import { NextResponse } from "next/server";

import { createPublicApiCaller } from "../../../_lib/caller";
import { errorResponse } from "../../../_lib/error";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const caller = await createPublicApiCaller(request);
    const body = await request.json();
    const result = await caller.publicApi.createArtifact({ runId, ...body });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
