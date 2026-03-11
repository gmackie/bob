import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { callClaude, execAsync } from "~/server/git-utils";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ worktreeId: string }>;
}

/**
 * POST /api/legacy/git/[worktreeId]/create-pr
 * Push branch and create a GitHub PR
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

    const { stdout: currentBranch } = await execAsync(
      "git branch --show-current",
      { cwd: worktree.path },
    );
    const branchName = currentBranch.trim();

    // Push to origin
    try {
      await execAsync(`git push -u origin ${branchName}`, {
        cwd: worktree.path,
      });
    } catch {
      await execAsync(`git push origin ${branchName}`, { cwd: worktree.path });
    }

    // Get diff and commits for PR content
    const { stdout: diff } = await execAsync("git diff main...HEAD", {
      cwd: worktree.path,
    });
    const { stdout: commits } = await execAsync(
      'git log main..HEAD --pretty=format:"%h %s"',
      { cwd: worktree.path },
    );

    // Generate PR title and description
    let prTitle = branchName
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
    let prDescription = `## Summary\n\nChanges in this pull request:\n\n${commits}\n\n🤖 Generated with Claude Code`;

    try {
      const titlePrompt = `Based on this git diff and commit history, generate a concise PR title that follows conventional commit format. Keep it under 72 characters. Types: feat, fix, docs, style, refactor, test, chore. Only return the title.`;
      const diffAndCommits = `${diff}\n\nCommits:\n${commits}`;
      const claudeTitleOutput = await callClaude(
        titlePrompt,
        diffAndCommits,
        worktree.path,
      );
      if (claudeTitleOutput) {
        prTitle = claudeTitleOutput;
      }

      const descPrompt = `Based on this git diff and commit history, generate a comprehensive PR description with:
1. ## Summary - What this PR does
2. ## Changes Made - Key modifications
3. ## Testing - How to test these changes
4. Use markdown formatting. Be detailed but concise.`;
      const claudeDescOutput = await callClaude(
        descPrompt,
        diffAndCommits,
        worktree.path,
      );
      if (claudeDescOutput) {
        prDescription = `${claudeDescOutput}\n\n🤖 Generated with Claude Code`;
      }
    } catch (claudeError) {
      console.warn(
        "Failed to generate PR content with Claude, using fallback:",
        claudeError,
      );
    }

    // Try to create PR using GitHub CLI
    try {
      const { stdout: prResult } = await execAsync(
        `gh pr create --title "${prTitle}" --body "${prDescription.replace(/"/g, '\\"')}" --base main`,
        { cwd: worktree.path },
      );

      return NextResponse.json({
        message: "Pull request created successfully",
        branch: branchName,
        title: prTitle,
        description: prDescription,
        pr: prResult.trim(),
      });
    } catch {
      return NextResponse.json({
        message: "Branch pushed successfully. Create PR manually on GitHub.",
        branch: branchName,
        title: prTitle,
      });
    }
  } catch (error) {
    console.error("Error creating PR:", error);
    return NextResponse.json(
      { error: "Failed to create pull request" },
      { status: 500 },
    );
  }
}
