import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { execAsync } from "~/server/git-utils";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ worktreeId: string }>;
}

/**
 * POST /api/legacy/git/[worktreeId]/revert
 * Revert all changes in worktree
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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

    await execAsync("git reset --hard HEAD", { cwd: worktree.path });
    await execAsync("git clean -fd", { cwd: worktree.path });

    return NextResponse.json({ message: "Changes reverted successfully" });
  } catch (error) {
    console.error("Error reverting changes:", error);
    return NextResponse.json(
      { error: "Failed to revert changes" },
      { status: 500 },
    );
  }
}
