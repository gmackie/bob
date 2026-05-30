import { NextResponse } from "next/server";

import { createPublicApiCaller, errorResponse } from "~/lib/rest/api-helpers";

export async function POST(request: Request) {
  try {
    const caller = await createPublicApiCaller(request);
    const body = (await request.json()) as Parameters<
      typeof caller.billing.createPortalSession
    >[0];
    const result = await caller.billing.createPortalSession(body);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
