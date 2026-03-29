import { NextResponse } from "next/server";

import { createPublicApiCaller, errorResponse } from "~/lib/rest/api-helpers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const caller = await createPublicApiCaller(request);
    const body = await request.json();
    const result = await caller.publicApi.registerWorkspace(body);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
