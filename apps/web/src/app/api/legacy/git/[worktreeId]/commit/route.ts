import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { execAsync } from "~/server/git-utils";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ worktreeId: string }>;
}

interface CommitBody {
  message: string;
}

/**
 * POST /api/legacy/git/[worktreeId]/commit
 * Stage and commit all changes
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { worktreeId } = await params;
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const body = (await request.json()) as CommitBody;
    const { message } = body;

    const { gitService } = await getServices();
    const worktree = gitService.getWorktree(worktreeId, userId);

    if (!worktree) {
      return NextResponse.json(
        { error: "Worktree not found" },
        { status: 404 },
      );
    }

    if (!message || !message.trim()) {
      return NextResponse.json(
        { error: "Commit message is required" },
        { status: 400 },
      );
    }

    const { stdout: status } = await execAsync("git status --porcelain", {
      cwd: worktree.path,
    });

    if (!status.trim()) {
      return NextResponse.json(
        { error: "No changes to commit" },
        { status: 400 },
      );
    }

    await execAsync("git add .", { cwd: worktree.path });

    const finalMessage = `${message}

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>`;

    await execAsync(`git commit -m "${finalMessage.replace(/"/g, '\\"')}"`, {
      cwd: worktree.path,
    });

    return NextResponse.json({
      message: "Changes committed successfully",
      commitMessage: finalMessage,
    });
  } catch (error) {
    console.error("Error committing changes:", error);
    return NextResponse.json(
      { error: "Failed to commit changes" },
      { status: 500 },
    );
  }
}
