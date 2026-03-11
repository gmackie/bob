import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { syncKanbangerReposForBobUser } from "~/server/kanbanger/sync-repos";

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

// Non-cron entrypoint intended for UI-triggered pre-seeding.
export async function POST(request: NextRequest) {
  const session = await getSession();
  const requireAuth = process.env.REQUIRE_AUTH === "true";
  if (requireAuth && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const dryRun = url.searchParams.get("dryRun") === "1";
  const includeCandidates =
    url.searchParams.get("candidates") === "1" ||
    url.searchParams.get("debug") === "1";

  try {
    const result = await syncKanbangerReposForBobUser({
      workspaceId,
      userId: session?.user?.id ?? null,
      dryRun,
      includeCandidates,
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
