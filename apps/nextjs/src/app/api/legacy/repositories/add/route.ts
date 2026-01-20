import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { getServices } from "~/server/services";

/**
 * POST /api/legacy/repositories/add
 * Legacy compatibility route (UI uses /repositories/add).
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
