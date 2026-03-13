import { NextResponse } from "next/server";

import { syncPlanningReposForBobUser } from "~/server/planning/sync-repos";
import { getPlanningRemoteConfig } from "~/lib/planning/remote-config";

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { apiKey } = getPlanningRemoteConfig();

  if (!apiKey) {
    return NextResponse.json(
      { error: "PLANNING_API_KEY not configured" },
      { status: 412 },
    );
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const userIdParam = url.searchParams.get("userId");

  try {
    const result = await syncPlanningReposForBobUser({
      workspaceId,
      userId: userIdParam,
    });
    return NextResponse.json(result);
  } catch (error) {
    const statusCode = getStatusCode(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: typeof statusCode === "number" ? statusCode : 500 },
    );
  }
}
