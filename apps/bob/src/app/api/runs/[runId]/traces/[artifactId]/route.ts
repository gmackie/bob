import { NextResponse } from "next/server";
import { buildTraceViewerUrl } from "@gmacko/core/telemetry/deep";
import { createPlanningClient } from "~/lib/planning/server";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ runId: string; artifactId: string }>;
  },
) {
  try {
    const { runId, artifactId } = await params;
    const caller = await createPlanningClient();
    // get enforces workspace membership before returning any artifacts.
    const run = await caller("agent.run.get").call({ runId });
    const artifact = run.artifacts.find((entry) => entry.id === artifactId);
    const metadata = artifact?.metadata;
    const url =
      metadata?.kind === "trace_reference" &&
      typeof metadata.traceId === "string"
        ? buildTraceViewerUrl(
            metadata.traceId,
            process.env.FORGEGRAPH_TRACE_VIEWER_URL ?? "",
          )
        : undefined;
    if (!url)
      return NextResponse.json(
        { error: "Trace viewer unavailable" },
        { status: 404 },
      );
    return NextResponse.redirect(url, {
      status: 307,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Trace unavailable" }, { status: 404 });
  }
}
