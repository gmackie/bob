import { NextResponse } from "next/server";

import { createPublicApiCaller, errorResponse } from "~/lib/rest/api-helpers";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    const caller = await createPublicApiCaller(request);
    const result = await caller.publicApi.heartbeat({ workspaceId });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
