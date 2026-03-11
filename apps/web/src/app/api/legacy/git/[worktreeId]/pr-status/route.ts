import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { execAsync } from "~/server/git-utils";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ worktreeId: string }>;
}

/**
 * GET /api/legacy/git/[worktreeId]/pr-status
 * Get PR status for a worktree branch
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

    // Check if gh is available
    try {
      await execAsync("gh --version");
    } catch {
      return NextResponse.json({ exists: false });
    }

    // Get PR info
    try {
      const { stdout } = await execAsync(
        `gh pr view ${worktree.branch} --json number,title,url,state`,
        { cwd: worktree.path },
      );

      const prData = JSON.parse(stdout) as {
        number: number;
        title: string;
        url: string;
        state: string;
      };

      return NextResponse.json({
        exists: true,
        number: prData.number,
        title: prData.title,
        url: prData.url,
        state: prData.state.toLowerCase(),
      });
    } catch {
      return NextResponse.json({ exists: false });
    }
  } catch (error) {
    console.error("Error getting PR status:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
