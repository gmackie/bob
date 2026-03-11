import { NextResponse } from "next/server";

import type { TerminalSession } from "@bob/legacy/services";

import { getServices } from "~/server/services";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;

    const { terminalService } = await getServices();
    const sessions = terminalService.getSessionsByInstance(id);

    return NextResponse.json(
      sessions.map((s: TerminalSession) => ({
        id: s.id,
        createdAt: s.createdAt,
        type: s.claudePty ? "claude" : s.pty ? "directory" : "unknown",
      })),
    );
  } catch (error) {
    console.error("Failed to get terminal sessions:", error);
    return NextResponse.json(
      { error: "Failed to get terminal sessions" },
      { status: 500 },
    );
  }
}
