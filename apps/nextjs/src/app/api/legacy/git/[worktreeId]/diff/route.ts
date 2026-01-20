import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { getCompleteDiff } from "~/server/git-utils";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ worktreeId: string }>;
}

/**
 * GET /api/legacy/git/[worktreeId]/diff
 * Get comprehensive diff including untracked files
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { worktreeId } = await params;
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const { gitService } = await getServices();
    const worktree = gitService.getWorktree(worktreeId, userId);

    if (!worktree) {
      return NextResponse.json(
        { error: "Worktree not found" },
        { status: 404 },
      );
    }

    const completeDiff = await getCompleteDiff(worktree.path);

    return new NextResponse(completeDiff, {
      headers: { "Content-Type": "text/plain" },
    });
  } catch (error) {
    console.error("Error getting git diff:", error);
    return NextResponse.json(
      { error: "Failed to get git diff" },
      { status: 500 },
    );
  }
}
