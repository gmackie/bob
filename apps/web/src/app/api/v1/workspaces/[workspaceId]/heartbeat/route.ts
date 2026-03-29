import { NextResponse } from "next/server";

import { createPublicApiCaller } from "../../../_lib/caller";
import { errorResponse } from "../../../_lib/error";

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
