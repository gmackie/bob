import { NextResponse } from "next/server";

import { createPublicApiCaller, errorResponse } from "~/lib/rest/api-helpers";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workItemId: string }> },
) {
  try {
    const { workItemId } = await params;
    const caller = await createPublicApiCaller(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "20");
    const result = await caller.publicApi.listRunsByWorkItem({
      workItemId,
      limit,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
