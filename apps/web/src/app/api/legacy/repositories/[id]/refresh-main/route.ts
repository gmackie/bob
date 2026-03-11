import { NextRequest, NextResponse } from "next/server";

import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { gitService } = await getServices();
    const repository = await gitService.refreshMainBranch(id);

    return NextResponse.json(repository);
  } catch (error) {
    console.error("Failed to refresh main branch:", error);
    return NextResponse.json(
      { error: `Failed to refresh main branch: ${error}` },
      { status: 500 },
    );
  }
}
