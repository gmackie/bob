import { NextResponse } from "next/server";
import { createPlanningClient } from "~/lib/planning/server";
import { getRunTraceStatuses } from "~/lib/traces/run-trace-status";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const caller = await createPlanningClient();
    const run = await caller("agent.run.get").call({ runId });
    const token = process.env.FORGEGRAPH_TRACE_API_TOKEN;
    const traces = await getRunTraceStatuses(
      { ...run, artifacts: [...run.artifacts] },
      token
        ? {
            baseUrl:
              process.env.FORGEGRAPH_TRACE_API_URL ?? "https://forgegraf.com",
            token,
          }
        : null,
    );
    return NextResponse.json(
      { traces },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Trace report unavailable" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
