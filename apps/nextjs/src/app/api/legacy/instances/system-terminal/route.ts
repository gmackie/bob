import { NextRequest, NextResponse } from "next/server";

import { getServices } from "~/server/services";

interface SystemTerminalBody {
  cwd?: string;
  initialCommand?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as SystemTerminalBody;
    const { cwd, initialCommand } = body;

    const { terminalService } = await getServices();
    const session = terminalService.createSystemSession(cwd, initialCommand);

    return NextResponse.json({ sessionId: session.id });
  } catch (error) {
    console.error("Failed to create system terminal:", error);
    return NextResponse.json(
      { error: `Failed to create system terminal: ${error}` },
      { status: 500 },
    );
  }
}
