import { NextResponse } from "next/server";

import { syncKanbangerReposForBobUser } from "~/server/kanbanger/sync-repos";

const CRON_SECRET = process.env.CRON_SECRET;
const KANBANGER_API_KEY = process.env.KANBANGER_API_KEY;

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!KANBANGER_API_KEY) {
    return NextResponse.json(
      { error: "KANBANGER_API_KEY not configured" },
      { status: 412 },
    );
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const userIdParam = url.searchParams.get("userId");

  try {
    const result = await syncKanbangerReposForBobUser({
      workspaceId,
      userId: userIdParam,
    });
    return NextResponse.json(result);
  } catch (error) {
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? (error as any).statusCode
        : undefined;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: typeof statusCode === "number" ? statusCode : 500 },
    );
  }
}
