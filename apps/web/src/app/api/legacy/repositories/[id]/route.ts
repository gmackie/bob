import { NextRequest, NextResponse } from "next/server";

import { getSession } from "~/auth/server";
import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await getSession();
    const userId = session?.user?.id ?? "default-user";

    const { gitService } = await getServices();
    const repository = gitService.getRepository(id, userId);

    if (!repository) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(repository);
  } catch (error) {
    console.error("Failed to get repository:", error);
    return NextResponse.json(
      { error: "Failed to get repository" },
      { status: 500 },
    );
  }
}
