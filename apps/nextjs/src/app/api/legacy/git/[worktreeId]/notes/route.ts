import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { execAsync } from "~/server/git-utils";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ worktreeId: string }>;
}

interface NotesBody {
  content?: string;
}

/**
 * GET /api/legacy/git/[worktreeId]/notes
 * Get branch-specific notes
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

    const { stdout: currentBranch } = await execAsync(
      "git branch --show-current",
      { cwd: worktree.path },
    );
    const branchName = currentBranch.trim();
    const notesFileName = `.bob-notes-${branchName}.md`;
    const notesFilePath = path.join(worktree.path, notesFileName);

    try {
      const notesContent = await fs.readFile(notesFilePath, "utf8");
      return NextResponse.json({
        content: notesContent,
        fileName: notesFileName,
      });
    } catch {
      return NextResponse.json({ content: "", fileName: notesFileName });
    }
  } catch (error) {
    console.error("Error getting notes:", error);
    return NextResponse.json({ error: "Failed to get notes" }, { status: 500 });
  }
}

/**
 * POST /api/legacy/git/[worktreeId]/notes
 * Save branch-specific notes
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { worktreeId } = await params;
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const body = (await request.json()) as NotesBody;
    const { content } = body;

    const { gitService } = await getServices();
    const worktree = gitService.getWorktree(worktreeId, userId);

    if (!worktree) {
      return NextResponse.json(
        { error: "Worktree not found" },
        { status: 404 },
      );
    }

    const { stdout: currentBranch } = await execAsync(
      "git branch --show-current",
      { cwd: worktree.path },
    );
    const branchName = currentBranch.trim();
    const notesFileName = `.bob-notes-${branchName}.md`;
    const notesFilePath = path.join(worktree.path, notesFileName);

    await fs.writeFile(notesFilePath, content || "", "utf8");

    return NextResponse.json({
      message: "Notes saved successfully",
      fileName: notesFileName,
      path: notesFilePath,
    });
  } catch (error) {
    console.error("Error saving notes:", error);
    return NextResponse.json(
      { error: "Failed to save notes" },
      { status: 500 },
    );
  }
}
