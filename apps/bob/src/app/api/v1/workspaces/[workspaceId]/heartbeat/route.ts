import { NextResponse } from "next/server";
import { createPublicApiCaller, errorResponse } from "~/lib/rest/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      agentTypes?: unknown;
      forgeAvailable?: unknown;
      repos?: unknown;
    };
    const caller = await createPublicApiCaller(request);
    const result = await caller.publicApi.heartbeat({
      workspaceId,
      agentTypes: Array.isArray(body.agentTypes) ? body.agentTypes : undefined,
      forgeAvailable: typeof body.forgeAvailable === "boolean" ? body.forgeAvailable : undefined,
      repos: Array.isArray(body.repos) ? body.repos : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
