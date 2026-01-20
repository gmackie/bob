import { NextRequest, NextResponse } from "next/server";

import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { gitService } = await getServices();
    const remotes = await gitService.getGitRemotes(id);

    return NextResponse.json(remotes);
  } catch (error) {
    console.error("Failed to get remotes:", error);
    return NextResponse.json(
      { error: `Failed to get remotes: ${error}` },
      { status: 500 },
    );
  }
}
