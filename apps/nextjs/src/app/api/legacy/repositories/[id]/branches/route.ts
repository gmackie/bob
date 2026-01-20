import { NextRequest, NextResponse } from "next/server";

import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { gitService } = await getServices();
    const branches = await gitService.getGitBranches(id);

    return NextResponse.json(branches);
  } catch (error) {
    console.error("Failed to get branches:", error);
    return NextResponse.json(
      { error: `Failed to get branches: ${error}` },
      { status: 500 },
    );
  }
}
