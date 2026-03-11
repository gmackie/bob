import { NextRequest, NextResponse } from "next/server";

import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { agentService } = await getServices();
    const instance = await agentService.restartInstance(id);

    return NextResponse.json(instance);
  } catch (error) {
    console.error("Failed to restart instance:", error);
    return NextResponse.json(
      { error: `Failed to restart instance: ${error}` },
      { status: 500 },
    );
  }
}
