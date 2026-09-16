import { NextResponse } from "next/server";
import {
  createPublicApiCaller,
  errorResponse,
  withApiRateLimit,
} from "~/lib/rest/api-helpers";
import { getRunTraceStatuses } from "~/lib/traces/run-trace-status";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  return withApiRateLimit(request, async () => {
    try {
      const { runId } = await params;
      const caller = await createPublicApiCaller(request);
      const run = await caller.publicApi.getRunTraceResource({ runId });
      const token = process.env.FORGEGRAPH_TRACE_API_TOKEN;
      const traces = await getRunTraceStatuses(
        run,
        token
          ? {
              baseUrl: process.env.FORGEGRAPH_TRACE_API_URL ?? "https://forgegraf.com",
              token,
            }
          : null,
      );
      return NextResponse.json(
        { traces },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (error) {
      return errorResponse(error);
    }
  });
}
