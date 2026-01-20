import { NextRequest, NextResponse } from "next/server";

import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { sessionId } = await params;

    const { terminalService } = await getServices();
    terminalService.closeSession(sessionId);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to close terminal session:", error);
    return NextResponse.json(
      { error: "Failed to close terminal session" },
      { status: 500 },
    );
  }
}
