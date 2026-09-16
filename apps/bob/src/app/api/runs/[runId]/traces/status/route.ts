import { NextResponse } from "next/server";
import { createPlanningCaller } from "~/lib/planning/server";
import { getRunTraceStatuses } from "~/lib/traces/run-trace-status";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const caller = await createPlanningCaller();
    const run = await caller.agentRun.get({ runId });
    const token = process.env.FG_API_TOKEN;
    const traces = await getRunTraceStatuses(
      run,
      token
        ? { baseUrl: process.env.FG_API_URL ?? "https://forgegraf.com", token }
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
