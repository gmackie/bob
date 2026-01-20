import { NextRequest, NextResponse } from "next/server";

import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { gitService } = await getServices();
    const graph = await gitService.getGitGraph(id);

    return NextResponse.json(graph);
  } catch (error) {
    console.error("Failed to get git graph:", error);
    return NextResponse.json(
      { error: `Failed to get git graph: ${error}` },
      { status: 500 },
    );
  }
}
