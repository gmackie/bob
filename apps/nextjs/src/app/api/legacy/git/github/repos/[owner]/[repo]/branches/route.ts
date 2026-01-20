import { NextRequest, NextResponse } from "next/server";

import { execAsync } from "~/server/git-utils";

interface RouteParams {
  params: Promise<{ owner: string; repo: string }>;
}

/**
 * GET /api/legacy/git/github/repos/[owner]/[repo]/branches
 * List branches for a GitHub repository
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { owner, repo } = await params;

    const { stdout } = await execAsync(
      `gh api repos/${owner}/${repo}/branches --paginate --jq '.[].name'`,
    );
    const branches = stdout
      .trim()
      .split("\n")
      .filter((b) => b);

    return NextResponse.json(branches);
  } catch (error) {
    console.error("Error listing branches:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
