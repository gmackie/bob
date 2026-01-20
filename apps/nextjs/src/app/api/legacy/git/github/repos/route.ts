import { existsSync, mkdirSync } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { execAsync } from "~/server/git-utils";
import { getServices } from "~/server/services";

/**
 * GET /api/legacy/git/github/repos
 * List GitHub repositories for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("search");
    const limit = url.searchParams.get("limit") || "50";

    const { stdout } = await execAsync(
      `gh repo list --json name,nameWithOwner,description,isPrivate,url --limit ${limit}`,
    );

    let repos = JSON.parse(stdout) as Array<{
      name: string;
      nameWithOwner: string;
      description?: string;
      isPrivate: boolean;
      url: string;
    }>;

    if (search) {
      const searchLower = search.toLowerCase();
      repos = repos.filter(
        (r) =>
          r.name.toLowerCase().includes(searchLower) ||
          r.nameWithOwner.toLowerCase().includes(searchLower) ||
          (r.description && r.description.toLowerCase().includes(searchLower)),
      );
    }

    return NextResponse.json(repos);
  } catch (error) {
    console.error("Error listing GitHub repos:", error);
    const errorMessage = (error as Error).message;
    if (
      errorMessage.includes("gh: command not found") ||
      errorMessage.includes("not logged in")
    ) {
      return NextResponse.json(
        { error: "GitHub CLI not authenticated. Run: gh auth login" },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
