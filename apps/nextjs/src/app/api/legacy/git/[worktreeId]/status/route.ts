import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { execAsync } from "~/server/git-utils";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ worktreeId: string }>;
}

/**
 * GET /api/legacy/git/[worktreeId]/status
 * Get git status for a worktree
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

    const { stdout: statusOutput } = await execAsync(
      "git status --porcelain --branch",
      { cwd: worktree.path },
    );
    const lines = statusOutput.split("\n").filter((l) => l.trim());

    // Parse branch info
    const branchLine = lines[0] || "";
    const branchMatch = branchLine.match(
      /## ([^\s.]+)(?:\.\.\.([^\s]+))?(?: \[(.+)\])?/,
    );
    const branch = branchMatch?.[1] || worktree.branch;
    const status = branchMatch?.[3] || "";

    // Parse ahead/behind
    let ahead = 0;
    let behind = 0;
    if (status) {
      const aheadMatch = status.match(/ahead (\d+)/);
      const behindMatch = status.match(/behind (\d+)/);
      if (aheadMatch?.[1]) ahead = parseInt(aheadMatch[1]);
      if (behindMatch?.[1]) behind = parseInt(behindMatch[1]);
    }

    // Count file changes
    const fileLines = lines.slice(1);
    const staged = fileLines.filter((l) => l[0] !== " " && l[0] !== "?").length;
    const unstaged = fileLines.filter(
      (l) => l[1] !== " " && l[0] !== "?",
    ).length;
    const untracked = fileLines.filter((l) => l.startsWith("??")).length;
    const hasChanges = fileLines.length > 0;

    return NextResponse.json({
      branch,
      ahead,
      behind,
      hasChanges,
      files: {
        staged,
        unstaged,
        untracked,
      },
    });
  } catch (error) {
    console.error("Error getting git status:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
