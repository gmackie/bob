import { NextResponse } from "next/server";

import { createPublicApiCaller } from "../_lib/caller";
import { errorResponse } from "../_lib/error";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const caller = await createPublicApiCaller(request);
    const body = await request.json();
    const result = await caller.publicApi.createRun(body);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const caller = await createPublicApiCaller(request);
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? "";
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    const result = await caller.publicApi.listRuns({ workspaceId, limit });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
