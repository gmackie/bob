import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { syncKanbangerReposForBobUser } from "~/server/kanbanger/sync-repos";

// Non-cron entrypoint intended for UI-triggered pre-seeding.
export async function POST(request: NextRequest) {
  const session = await getSession();
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");

  try {
    const result = await syncKanbangerReposForBobUser({
      workspaceId,
      userId: session?.user?.id ?? null,
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
