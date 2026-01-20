import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { callAgent, execAsync } from "~/server/git-utils";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ worktreeId: string }>;
}

interface GenerateCommitMessageBody {
  comments?: Array<{
    file: string;
    line: number;
    type: string;
    message: string;
    isAI?: boolean;
    userReply?: string;
  }>;
}

/**
 * POST /api/legacy/git/[worktreeId]/generate-commit-message
 * Generate AI commit message from diff
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { worktreeId } = await params;
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const body = (await request.json()) as GenerateCommitMessageBody;
    const { comments } = body;

    const { gitService, agentService } = await getServices();
    const worktree = gitService.getWorktree(worktreeId, userId);

    if (!worktree) {
      return NextResponse.json(
        { error: "Worktree not found" },
        { status: 404 },
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

    const { stdout: diff } = await execAsync("git diff HEAD", {
      cwd: worktree.path,
    });

    const { stdout: changedFiles } = await execAsync(
      "git diff --name-only HEAD",
      { cwd: worktree.path },
    );

    if (!diff.trim()) {
      return NextResponse.json({ error: "No diff available" }, { status: 400 });
    }

    try {
      let diffWithComments = diff;
      if (comments && comments.length > 0) {
        diffWithComments += "\n\n=== CODE REVIEW COMMENTS ===\n";
        const commentsByFile = comments.reduce(
          (acc: Record<string, typeof comments>, comment) => {
            const fileKey = comment.file;
            if (!acc[fileKey]) acc[fileKey] = [];
            acc[fileKey]!.push(comment);
            return acc;
          },
          {},
        );

        Object.entries(commentsByFile).forEach(([file, fileComments]) => {
          diffWithComments += `\nFile: ${file}\n`;
          fileComments.forEach((comment) => {
            diffWithComments += `Line ${comment.line} (${comment.type}${comment.isAI ? " - AI Generated" : " - User"}): ${comment.message}\n`;
            if (comment.userReply) {
              diffWithComments += `  User Reply: ${comment.userReply}\n`;
            }
          });
        });
      }

      const bodyPrompt = `Analyze this git diff and generate a detailed commit message body that explains what changed and why. The body should:
1. Explain the purpose of the changes
2. List the key modifications made
3. Mention any important technical details
4. Be 3-5 sentences that provide comprehensive context
${comments && comments.length > 0 ? "5. Consider the code review comments provided to understand context and improvements made" : ""}

Only return the body content, no subject line. Focus on the actual code changes, not just file counts.`;

      const instances = agentService.getInstancesByWorktree(worktreeId, userId);
      const agentType = instances[0]?.agentType ?? "claude";

      const commitBody = await callAgent(
        agentType,
        bodyPrompt,
        diffWithComments,
        worktree.path,
      );

      const subjectPrompt = `Based on this commit body, generate a concise subject line following conventional commit format (type: description). Subject should be under 72 characters. Types: feat, fix, docs, style, refactor, test, chore. Only return the subject line.`;

      const commitSubject = await callAgent(
        agentType,
        subjectPrompt,
        commitBody,
        worktree.path,
      );

      const aiCommitMessage = `${commitSubject}\n\n${commitBody}`;

      return NextResponse.json({
        commitMessage: aiCommitMessage,
        commitSubject: commitSubject,
        commitBody: commitBody,
        changedFiles: changedFiles.split("\n").filter((f) => f.trim()),
        fileCount: changedFiles.split("\n").filter((f) => f.trim()).length,
      });
    } catch (agentError) {
      console.error("Error calling agent for commit message:", agentError);

      const files = status.split("\n").filter((line) => line.trim()).length;
      const fallbackSubject = `Update ${files} file${files !== 1 ? "s" : ""}`;
      const fallbackBody = `Updated files: ${changedFiles
        .split("\n")
        .filter((f) => f.trim())
        .join(", ")}`;
      const fallbackMessage = `${fallbackSubject}\n\n${fallbackBody}`;

      return NextResponse.json({
        commitMessage: fallbackMessage,
        commitSubject: fallbackSubject,
        commitBody: fallbackBody,
        changedFiles: changedFiles.split("\n").filter((f) => f.trim()),
        fileCount: files,
        fallback: true,
      });
    }
  } catch (error) {
    console.error("Error generating commit message:", error);
    return NextResponse.json(
      { error: "Failed to generate commit message" },
      { status: 500 },
    );
  }
}
