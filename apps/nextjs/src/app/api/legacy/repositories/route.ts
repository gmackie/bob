import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { getServices } from "~/server/services";

/**
 * GET /api/legacy/repositories
 * List all repositories for the current user
 */
export async function GET() {
  try {
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const { gitService } = await getServices();
    const repositories = gitService.getRepositories(userId);

    return NextResponse.json(repositories);
  } catch (error) {
    console.error("Failed to get repositories:", error);
    return NextResponse.json(
      { error: "Failed to get repositories" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/legacy/repositories
 * Add a new repository (equivalent to POST /add in Express)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const body = await request.json();
    const { repositoryPath } = body as { repositoryPath?: string };

    if (!repositoryPath) {
      return NextResponse.json(
        { error: "repositoryPath is required" },
        { status: 400 },
      );
    }

    const { gitService } = await getServices();
    const repository = await gitService.addRepository(repositoryPath, userId);

    return NextResponse.json(repository, { status: 201 });
  } catch (error) {
    console.error("Failed to add repository:", error);
    return NextResponse.json(
      { error: `Failed to add repository: ${error}` },
      { status: 500 },
    );
  }
}
