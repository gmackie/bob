import { NextResponse } from "next/server";
import { createPublicApiCaller, errorResponse, withApiRateLimit } from "~/lib/rest/api-helpers";

/** Dispatch an existing authorized task through the same path as the UI. */
export async function POST(request: Request, { params }: { params: Promise<{ workItemId: string }> }) {
  return withApiRateLimit(request, async () => {
    try {
      const { workItemId } = await params;
      const caller = await createPublicApiCaller(request);
      const body = await request.json() as { agentType?: string };
      const result = await caller.publicApi.dispatchExistingWorkItem({ workItemId, agentType: body.agentType });
      return NextResponse.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  });
}
